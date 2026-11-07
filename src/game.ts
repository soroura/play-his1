import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import type { Content, Round } from "./content.ts";
import { outcomeOf, scoreAnswer } from "./scoring.ts";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Phase = "lobby" | "scene" | "question" | "reveal" | "leaderboard" | "running" | "final";
export type Lang = "en" | "ar";
/** screen: scene on the shared screen, facilitator paces (the original game). phones: same pacing, scene and full feedback also on phones. self: each player moves alone on their phone. */
export type Mode = "screen" | "phones" | "self";
export type SelfStep = "scene" | "question" | "reveal" | "done";
/** Owner id of the main facilitator (the HOST_PIN holder). Added facilitators have ids from 1. */
export const MAIN_OWNER = 0;

interface GameRow {
  id: number;
  code: string;
  status: string;
  phase: Phase;
  round_idx: number;
  phase_started: number;
  deadline: number;
  version: number;
  created_at: number;
  round_ids: string | null;
  owner_id: number;
  mode: Mode;
}
export interface FacilitatorRow {
  id: number;
  name: string;
  pin_hash: string;
  created_at: number;
  last_login: number | null;
}
interface PlayerRow {
  token: string;
  game_id: number;
  nickname: string;
  lang: Lang;
  joined_at: number;
  join_round: number;
  self_round: number;
  self_step: SelfStep;
}
interface AnswerRow {
  game_id: number;
  token: string;
  round_idx: number;
  option_key: string;
  answered_at: number;
  points: number;
  base: number;
  bonus: number;
  knockout: number;
}

export const EXTEND_MS = 15_000;
export const CONNECTED_MS = 10_000;
export const ANSWER_GRACE_MS = 1_500;
export const REPORT_DAYS = 14;
export const MAX_FACILITATORS = 100;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  phase TEXT NOT NULL,
  round_idx INTEGER NOT NULL DEFAULT 0,
  phase_started INTEGER NOT NULL,
  deadline INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  round_ids TEXT,
  owner_id INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'screen'
);
CREATE TABLE IF NOT EXISTS facilitators(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_login INTEGER
);
CREATE TABLE IF NOT EXISTS players(
  token TEXT PRIMARY KEY,
  game_id INTEGER NOT NULL,
  nickname TEXT NOT NULL,
  lang TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  join_round INTEGER NOT NULL DEFAULT 0,
  self_round INTEGER NOT NULL DEFAULT 0,
  self_step TEXT NOT NULL DEFAULT 'scene'
);
CREATE INDEX IF NOT EXISTS players_game ON players(game_id);
CREATE TABLE IF NOT EXISTS answers(
  game_id INTEGER NOT NULL,
  token TEXT NOT NULL,
  round_idx INTEGER NOT NULL,
  option_key TEXT NOT NULL,
  answered_at INTEGER NOT NULL,
  points INTEGER NOT NULL,
  base INTEGER NOT NULL,
  bonus INTEGER NOT NULL,
  knockout INTEGER NOT NULL,
  PRIMARY KEY(token, round_idx)
);
CREATE INDEX IF NOT EXISTS answers_game_round ON answers(game_id, round_idx);
`;

export function sanitizeNickname(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(cleaned).slice(0, 20).join("").trim();
}

/** Idempotent migrations for databases created by earlier releases. */
export function migrate(db: Database): void {
  const add = (table: string, col: string, def: string) => {
    const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  };
  add("games", "round_ids", "TEXT");
  add("games", "owner_id", "INTEGER NOT NULL DEFAULT 0");
  add("games", "mode", "TEXT NOT NULL DEFAULT 'screen'");
  add("players", "self_round", "INTEGER NOT NULL DEFAULT 0");
  add("players", "self_step", "TEXT NOT NULL DEFAULT 'scene'");
}

export class Engine {
  readonly db: Database;
  private seen = new Map<string, number>();
  constructor(
    dbPath: string,
    readonly content: Content,
    private readonly clock: () => number = () => Date.now(),
  ) {
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 3000;");
    this.db.exec(SCHEMA);
    migrate(this.db);
    // After a restart nobody has polled yet: treat every known player as connected so a
    // question does not auto-close before clients have had a chance to reconnect.
    const now = this.clock();
    for (const r of this.db.query("SELECT token FROM players").all() as { token: string }[]) this.seen.set(r.token, now);
  }

  close() {
    this.db.close();
  }

  now() {
    return this.clock();
  }

  /** All rounds in the content file (the pool a game can pick from). */
  get rounds() {
    return this.content.rounds;
  }

  /** Default selection: every round in the "core" set (all rounds if none is core). */
  defaultRoundIds(): number[] {
    const core = this.content.rounds.filter((r) => r.set === "core");
    return (core.length ? core : this.content.rounds).map((r) => r.id);
  }

  /** Validate a requested selection: content order, deduplicated, at least one, all ids known. */
  resolveRoundIds(input: unknown): number[] {
    if (input === undefined || input === null) return this.defaultRoundIds();
    if (!Array.isArray(input) || input.length === 0) throw new HttpError(400, "Pick at least one round");
    if (input.length > 200) throw new HttpError(400, "Too many rounds");
    const known = new Set(this.content.rounds.map((r) => r.id));
    for (const v of input) if (typeof v !== "number" || !Number.isInteger(v) || !known.has(v)) throw new HttpError(400, `Unknown round id: ${String(v).slice(0, 20)}`);
    const want = new Set(input as number[]);
    return this.content.rounds.filter((r) => want.has(r.id)).map((r) => r.id);
  }

  /** The rounds this game plays, in order. round_idx indexes into this list. NULL (games from before selection existed) = default. */
  gameRounds(g: GameRow): Round[] {
    let ids: number[] | null = null;
    if (g.round_ids) {
      try {
        const v = JSON.parse(g.round_ids);
        if (Array.isArray(v)) ids = v.filter((x) => typeof x === "number");
      } catch {
        /* fall through to default */
      }
    }
    const byId = new Map(this.content.rounds.map((r) => [r.id, r]));
    const list = (ids ?? this.defaultRoundIds()).map((id) => byId.get(id)).filter((r): r is Round => !!r);
    return list.length ? list : this.content.rounds;
  }

  // ---------- games ----------
  /** The owner's current game. Each facilitator has their own room. */
  activeGame(owner = MAIN_OWNER): GameRow | null {
    return this.db.query("SELECT * FROM games WHERE status='active' AND owner_id=? ORDER BY id DESC LIMIT 1").get(owner) as GameRow | null;
  }

  private gameById(id: number): GameRow | null {
    return this.db.query("SELECT * FROM games WHERE id=?").get(id) as GameRow | null;
  }

  resolveMode(input: unknown): Mode {
    if (input === undefined || input === null) return "screen";
    if (input === "screen" || input === "phones" || input === "self") return input;
    throw new HttpError(400, "Unknown game mode");
  }

  /** Room codes are unique among active games, whoever owns them; players find their game by code alone. */
  private freeCode(): string {
    const inUse = new Set((this.db.query("SELECT code FROM games WHERE status='active'").all() as { code: string }[]).map((r) => r.code));
    for (let i = 0; i < 200; i++) {
      const code = String(1000 + (randomBytes(4).readUInt32BE(0) % 9000));
      if (!inUse.has(code)) return code;
    }
    throw new HttpError(503, "No free room code. Try again.");
  }

  /** Creates a game for this owner. Ends only this owner's previous game: players there land on the final screen and keep their reports. */
  createGame(roundIdsIn?: unknown, opts: { owner?: number; mode?: unknown } = {}): GameRow {
    const roundIds = this.resolveRoundIds(roundIdsIn);
    const mode = this.resolveMode(opts.mode);
    const owner = opts.owner ?? MAIN_OWNER;
    const now = this.now();
    const tx = this.db.transaction(() => {
      this.endGamesOf(owner);
      this.db
        .query("INSERT INTO games(code,status,phase,round_idx,phase_started,deadline,version,created_at,round_ids,owner_id,mode) VALUES(?, 'active','lobby',0,?,0,1,?,?,?,?)")
        .run(this.freeCode(), now, now, JSON.stringify(roundIds), owner, mode);
    });
    tx();
    return this.activeGame(owner) as GameRow;
  }

  private endGamesOf(owner: number) {
    this.db.query("UPDATE games SET status='closed', phase='final', version=version+1 WHERE status='active' AND owner_id=?").run(owner);
  }

  private bump(g: GameRow) {
    this.db.query("UPDATE games SET version=version+1 WHERE id=?").run(g.id);
  }

  private setPhase(g: GameRow, phase: Phase, roundIdx: number) {
    const now = this.now();
    let deadline = 0;
    if (phase === "question") {
      const r = this.gameRounds(g)[roundIdx];
      if (!r) throw new HttpError(500, "round missing");
      deadline = now + r.timeLimit * 1000;
    }
    this.db
      .query("UPDATE games SET phase=?, round_idx=?, phase_started=?, deadline=?, version=version+1 WHERE id=?")
      .run(phase, roundIdx, now, deadline, g.id);
  }

  /** Move to the next step. `from` (e.g. "question:2") guards against double clicks. */
  advance(from?: string, owner = MAIN_OWNER): GameRow {
    const g = this.requireGame(owner);
    if (from && from !== `${g.phase}:${g.round_idx}`) return g;
    switch (g.phase) {
      case "lobby":
        this.setPhase(g, g.mode === "self" ? "running" : "scene", 0);
        break;
      case "running":
        this.setPhase(g, "final", g.round_idx);
        break;
      case "scene":
        this.setPhase(g, "question", g.round_idx);
        break;
      case "question":
        this.setPhase(g, "reveal", g.round_idx);
        break;
      case "reveal":
        this.setPhase(g, "leaderboard", g.round_idx);
        break;
      case "leaderboard":
        if (g.round_idx + 1 < this.gameRounds(g).length) this.setPhase(g, "scene", g.round_idx + 1);
        else this.setPhase(g, "final", g.round_idx);
        break;
      case "final":
        break;
    }
    return this.requireGame(owner);
  }

  /** Close the question early and show the reveal. */
  reveal(owner = MAIN_OWNER): GameRow {
    const g = this.requireGame(owner);
    if (g.phase === "question") this.setPhase(g, "reveal", g.round_idx);
    return this.requireGame(owner);
  }

  extend(ms = EXTEND_MS, owner = MAIN_OWNER): GameRow {
    const g = this.requireGame(owner);
    if (g.phase !== "question") throw new HttpError(409, "No question is open");
    this.db.query("UPDATE games SET deadline=deadline+?, version=version+1 WHERE id=?").run(ms, g.id);
    return this.requireGame(owner);
  }

  private requireGame(owner: number): GameRow {
    const g = this.activeGame(owner);
    if (!g) throw new HttpError(404, "No active game");
    return g;
  }

  /** Time-driven transitions: question closes at the deadline or when all connected players answered. */
  tick(): void {
    const now = this.now();
    for (const g of this.db.query("SELECT * FROM games WHERE status='active' AND phase='question'").all() as GameRow[]) {
      if (now >= g.deadline) this.setPhase(g, "reveal", g.round_idx);
      else this.maybeCloseAllAnswered(g);
    }
  }

  private maybeCloseAllAnswered(g: GameRow) {
    const { answered, connected } = this.progress(g);
    if (connected > 0 && answered >= connected) this.setPhase(g, "reveal", g.round_idx);
  }

  private progress(g: GameRow): { answered: number; connected: number; total: number } {
    const now = this.now();
    const players = this.db.query("SELECT token FROM players WHERE game_id=?").all(g.id) as { token: string }[];
    const answeredSet = new Set(
      (this.db.query("SELECT token FROM answers WHERE game_id=? AND round_idx=?").all(g.id, g.round_idx) as { token: string }[]).map((a) => a.token),
    );
    let connected = 0;
    for (const p of players) {
      const s = this.seen.get(p.token);
      if (answeredSet.has(p.token) || (s !== undefined && now - s <= CONNECTED_MS)) connected++;
    }
    return { answered: answeredSet.size, connected, total: players.length };
  }

  // ---------- players ----------
  private playerByToken(token: unknown): PlayerRow {
    if (typeof token !== "string" || !/^[0-9a-f]{32}$/.test(token)) throw new HttpError(404, "Unknown player");
    const p = this.db.query("SELECT * FROM players WHERE token=?").get(token) as PlayerRow | null;
    if (!p) throw new HttpError(404, "Unknown player");
    return p;
  }

  join(input: { code?: unknown; nickname?: unknown; lang?: unknown; token?: unknown }): { token: string; nickname: string; lang: Lang; rejoined: boolean } {
    const lang: Lang = input.lang === "ar" ? "ar" : "en";
    // silent rejoin
    if (typeof input.token === "string" && /^[0-9a-f]{32}$/.test(input.token)) {
      const existing = this.db.query("SELECT * FROM players WHERE token=?").get(input.token) as PlayerRow | null;
      if (existing) {
        // Rejoin only the player's own game while it is still active, and only if it matches a code given in the link;
        // otherwise an old token from an earlier game would hijack a new invite link.
        const eg = this.gameById(existing.game_id);
        const codeIn = typeof input.code === "string" ? input.code.trim() : "";
        if (eg && eg.status === "active" && (!codeIn || codeIn === eg.code)) {
          if (input.lang === "ar" || input.lang === "en") this.db.query("UPDATE players SET lang=? WHERE token=?").run(lang, existing.token);
          this.seen.set(existing.token, this.now());
          return { token: existing.token, nickname: existing.nickname, lang: input.lang ? lang : existing.lang, rejoined: true };
        }
        if (!codeIn) throw new HttpError(409, "That game has ended. Enter the new room code.");
      }
    }
    const code = typeof input.code === "string" ? input.code.trim() : String(input.code ?? "");
    if (!/^\d{4}$/.test(code)) throw new HttpError(400, "Enter the 4-digit room code");
    const g = this.db.query("SELECT * FROM games WHERE status='active' AND code=?").get(code) as GameRow | null;
    if (!g) throw new HttpError(404, "Room not found. Check the code on the shared screen.");
    if (g.phase === "final") throw new HttpError(409, "This game has finished");
    const base = sanitizeNickname(input.nickname);
    if (!base) throw new HttpError(400, "Enter a nickname");
    const taken = new Set(
      (this.db.query("SELECT nickname FROM players WHERE game_id=?").all(g.id) as { nickname: string }[]).map((r) => r.nickname.toLowerCase()),
    );
    let nick = base;
    for (let n = 2; taken.has(nick.toLowerCase()); n++) {
      const suffix = ` ${n}`;
      nick = Array.from(base).slice(0, 20 - suffix.length).join("").trimEnd() + suffix;
    }
    const token = randomBytes(16).toString("hex");
    const now = this.now();
    this.db
      .query("INSERT INTO players(token,game_id,nickname,lang,joined_at,join_round) VALUES(?,?,?,?,?,?)")
      .run(token, g.id, nick, lang, now, g.round_idx);
    this.seen.set(token, now);
    this.bump(g);
    return { token, nickname: nick, lang, rejoined: false };
  }

  answer(tokenIn: unknown, key: unknown): { locked: true; key: string } {
    const p = this.playerByToken(tokenIn);
    const g = this.gameById(p.game_id);
    if (!g || g.status !== "active") throw new HttpError(409, "Game is over");
    const now = this.now();
    this.seen.set(p.token, now);
    if (g.mode === "self") return this.answerSelf(p, g, key);
    if (g.phase !== "question") throw new HttpError(409, "No question is open");
    if (now > g.deadline + ANSWER_GRACE_MS) throw new HttpError(409, "Time is up");
    const r = this.gameRounds(g)[g.round_idx] as Round;
    const opt = r.options.find((o) => o.key === key);
    if (!opt) throw new HttpError(400, "Unknown option");
    const prev = this.db.query("SELECT option_key FROM answers WHERE token=? AND round_idx=?").get(p.token, g.round_idx) as { option_key: string } | null;
    if (prev) return { locked: true, key: prev.option_key }; // one answer only; first one wins
    const total = g.deadline - g.phase_started;
    const s = scoreAnswer(opt, g.deadline - now, total);
    this.db
      .query("INSERT INTO answers(game_id,token,round_idx,option_key,answered_at,points,base,bonus,knockout) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(g.id, p.token, g.round_idx, opt.key, now, s.points, s.base, s.bonus, s.knockout ? 1 : 0);
    this.bump(g);
    this.maybeCloseAllAnswered(this.gameById(g.id) as GameRow);
    return { locked: true, key: opt.key };
  }

  /** Self-paced answer: the player's own round, no clock, so no speed bonus. Moves the player on to their reveal. */
  private answerSelf(p: PlayerRow, g: GameRow, key: unknown): { locked: true; key: string } {
    if (g.phase !== "running") throw new HttpError(409, "No question is open");
    const r = this.gameRounds(g)[p.self_round] as Round;
    const opt = r.options.find((o) => o.key === key);
    if (!opt) throw new HttpError(400, "Unknown option");
    const prev = this.db.query("SELECT option_key FROM answers WHERE token=? AND round_idx=?").get(p.token, p.self_round) as { option_key: string } | null;
    if (prev) return { locked: true, key: prev.option_key };
    if (p.self_step !== "question") throw new HttpError(409, "No question is open");
    const s = scoreAnswer(opt, 0, 0);
    const tx = this.db.transaction(() => {
      this.db
        .query("INSERT INTO answers(game_id,token,round_idx,option_key,answered_at,points,base,bonus,knockout) VALUES(?,?,?,?,?,?,?,?,?)")
        .run(g.id, p.token, p.self_round, opt.key, this.now(), s.points, s.base, s.bonus, s.knockout ? 1 : 0);
      this.db.query("UPDATE players SET self_step='reveal' WHERE token=?").run(p.token);
    });
    tx();
    this.bump(g);
    return { locked: true, key: opt.key };
  }

  /** Self-paced: the player's own Next. `from` (e.g. "scene:2") makes a double tap harmless. */
  selfNext(tokenIn: unknown, from?: unknown): void {
    const p = this.playerByToken(tokenIn);
    const g = this.gameById(p.game_id);
    if (!g || g.status !== "active" || g.mode !== "self" || g.phase !== "running") throw new HttpError(409, "This game is not self-paced or is not open");
    this.seen.set(p.token, this.now());
    if (typeof from === "string" && from !== `${p.self_step}:${p.self_round}`) return;
    const setStep = (step: SelfStep, round: number) => this.db.query("UPDATE players SET self_step=?, self_round=? WHERE token=?").run(step, round, p.token);
    if (p.self_step === "scene") setStep("question", p.self_round);
    else if (p.self_step === "reveal") {
      if (p.self_round + 1 < this.gameRounds(g).length) setStep("scene", p.self_round + 1);
      else setStep("done", p.self_round);
    } else if (p.self_step === "question") throw new HttpError(409, "Answer the question first");
    else return;
    this.bump(g);
  }

  // ---------- facilitators ----------
  facilitator(id: number): FacilitatorRow | null {
    return this.db.query("SELECT * FROM facilitators WHERE id=?").get(id) as FacilitatorRow | null;
  }

  facilitatorByPinHash(hash: string): FacilitatorRow | null {
    return this.db.query("SELECT * FROM facilitators WHERE pin_hash=?").get(hash) as FacilitatorRow | null;
  }

  noteFacilitatorLogin(id: number): void {
    this.db.query("UPDATE facilitators SET last_login=? WHERE id=?").run(this.now(), id);
  }

  addFacilitator(nameIn: unknown, pinHash: string): FacilitatorRow {
    const name = sanitizeNickname(nameIn);
    if (!name) throw new HttpError(400, "Enter a name");
    const all = this.db.query("SELECT name FROM facilitators").all() as { name: string }[];
    if (all.length >= MAX_FACILITATORS) throw new HttpError(400, `At most ${MAX_FACILITATORS} facilitators`);
    if (all.some((f) => f.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, "That name is already on the list");
    const row = this.db.query("INSERT INTO facilitators(name,pin_hash,created_at) VALUES(?,?,?) RETURNING *").get(name, pinHash, this.now()) as FacilitatorRow;
    return row;
  }

  /** A new PIN also ends the facilitator's existing logins: their cookie is signed with the PIN hash. */
  setFacilitatorPin(id: number, pinHash: string): FacilitatorRow {
    if (!this.facilitator(id)) throw new HttpError(404, "Facilitator not found");
    this.db.query("UPDATE facilitators SET pin_hash=? WHERE id=?").run(pinHash, id);
    return this.facilitator(id) as FacilitatorRow;
  }

  /** Removes access at once and ends the facilitator's running game (its players keep their reports). */
  removeFacilitator(id: number): void {
    if (!this.facilitator(id)) throw new HttpError(404, "Facilitator not found");
    const tx = this.db.transaction(() => {
      this.endGamesOf(id);
      this.db.query("DELETE FROM facilitators WHERE id=?").run(id);
    });
    tx();
  }

  /** Who has access and which rooms are open, for the main facilitator's team screen. Never returns PIN hashes. */
  team(): { main: unknown; facilitators: unknown[] } {
    const room = (owner: number) => {
      const g = this.activeGame(owner);
      if (!g) return null;
      const n = (this.db.query("SELECT COUNT(*) AS n FROM players WHERE game_id=?").get(g.id) as { n: number }).n;
      return { code: g.code, mode: g.mode, phase: g.phase, players: n, rounds: this.gameRounds(g).length };
    };
    const rows = this.db.query("SELECT * FROM facilitators ORDER BY name COLLATE NOCASE").all() as FacilitatorRow[];
    return { main: { room: room(MAIN_OWNER) }, facilitators: rows.map((f) => ({ id: f.id, name: f.name, createdAt: f.created_at, lastLogin: f.last_login, room: room(f.id) })) };
  }

  // ---------- views ----------
  private revealedCount(g: GameRow): number {
    switch (g.phase) {
      case "lobby":
      case "running":
      case "scene":
      case "question":
        return g.round_idx;
      case "reveal":
      case "leaderboard":
        return g.round_idx + 1;
      case "final":
        return this.gameRounds(g).length;
    }
  }

  private standings(g: GameRow, deltaRound: number | null) {
    const rows = this.db
      .query(
        `SELECT p.token, p.nickname, p.joined_at,
                COALESCE((SELECT SUM(points) FROM answers a WHERE a.token=p.token),0) AS total,
                COALESCE((SELECT SUM(knockout) FROM answers a WHERE a.token=p.token),0) AS knockouts,
                ${deltaRound === null ? "0" : "COALESCE((SELECT points FROM answers a WHERE a.token=p.token AND a.round_idx=" + Number(deltaRound) + "),0)"} AS delta
         FROM players p WHERE p.game_id=? ORDER BY total DESC, p.joined_at ASC`,
      )
      .all(g.id) as { token: string; nickname: string; joined_at: number; total: number; knockouts: number; delta: number }[];
    let prevTotal = -1;
    let prevRank = 0;
    return rows.map((r, i) => {
      const rank = r.total === prevTotal ? prevRank : i + 1;
      prevTotal = r.total;
      prevRank = rank;
      return { ...r, rank };
    });
  }

  private publicRound(g: GameRow, withQuestion: boolean, index = g.round_idx) {
    const r = this.gameRounds(g)[index] as Round;
    const out: Record<string, unknown> = {
      id: r.id,
      index,
      clock: r.clock,
      place: r.place,
      title: r.title,
    };
    if (withQuestion) {
      out.question = r.question;
      out.options = r.options.map((o) => ({ key: o.key, text: o.text }));
      out.timeLimit = r.timeLimit;
    }
    return out;
  }

  private revealBlock(g: GameRow) {
    const r = this.gameRounds(g)[g.round_idx] as Round;
    const counts = new Map<string, number>();
    for (const a of this.db.query("SELECT option_key, COUNT(*) AS n FROM answers WHERE game_id=? AND round_idx=? GROUP BY option_key").all(g.id, g.round_idx) as {
      option_key: string;
      n: number;
    }[])
      counts.set(a.option_key, a.n);
    const best = r.options.find((o) => o.score === 1000);
    return {
      best: best?.key,
      options: r.options.map((o) => ({ key: o.key, text: o.text, score: o.score, knockout: o.knockout, feedback: o.feedback, count: counts.get(o.key) ?? 0 })),
      why: r.why,
      standards: r.standards,
      realCase: r.realCase,
    };
  }

  private timing(g: GameRow) {
    const now = this.now();
    if (g.phase !== "question") return {};
    return { deadline: g.deadline, remainingMs: Math.max(0, g.deadline - now), totalMs: g.deadline - g.phase_started };
  }

  /** Self-paced progress for the facilitator: who is where, and how each round is going. No player tokens. */
  private board(g: GameRow) {
    const rounds = this.gameRounds(g);
    const steps = new Map(
      (this.db.query("SELECT token, self_round, self_step FROM players WHERE game_id=?").all(g.id) as { token: string; self_round: number; self_step: SelfStep }[]).map((p) => [p.token, p]),
    );
    const now = this.now();
    const people = this.standings(g, null)
      .slice(0, 300)
      .map((s) => {
        const p = steps.get(s.token);
        const seen = this.seen.get(s.token);
        return { name: s.nickname, rank: s.rank, total: s.total, knockouts: s.knockouts, round: (p?.self_round ?? 0) + 1, step: p?.self_step ?? "scene", online: seen !== undefined && now - seen <= CONNECTED_MS };
      });
    const tallies = this.db.query("SELECT round_idx, option_key, COUNT(*) AS n, SUM(knockout) AS k FROM answers WHERE game_id=? GROUP BY round_idx, option_key").all(g.id) as { round_idx: number; option_key: string; n: number; k: number }[];
    const roundStats = rounds.map((r, i) => {
      const best = r.options.find((o) => o.score === 1000)?.key;
      const mine = tallies.filter((t) => t.round_idx === i);
      return {
        id: r.id,
        title: r.title,
        answered: mine.reduce((a, t) => a + t.n, 0),
        best: mine.filter((t) => t.option_key === best).reduce((a, t) => a + t.n, 0),
        knockouts: mine.reduce((a, t) => a + t.k, 0),
      };
    });
    return { finished: people.filter((p) => p.step === "done").length, total: steps.size, people, rounds: roundStats };
  }

  hostState(joinUrl: string, since?: number, owner = MAIN_OWNER): Record<string, unknown> {
    this.tick();
    const g = this.activeGame(owner);
    const now = this.now();
    if (!g) return { ok: true, game: null, now, version: 0, meta: this.content.meta, rounds: this.rounds.length };
    if (since !== undefined && since === g.version && g.phase !== "question") return { ok: true, same: true, version: g.version, now };
    const prog = this.progress(g);
    const base: Record<string, unknown> = {
      ok: true,
      version: g.version,
      now,
      meta: this.content.meta,
      game: { id: g.id, code: g.code, mode: g.mode, phase: g.phase, round: g.round_idx, rounds: this.gameRounds(g).length, roundIds: this.gameRounds(g).map((x) => x.id), joinUrl, ...this.timing(g) },
      players: { total: prog.total, connected: prog.connected },
      answered: g.phase === "question" || g.phase === "reveal" ? prog.answered : 0,
      answerTotal: Math.max(prog.connected, prog.answered),
    };
    if (g.phase === "lobby" || g.phase === "final") {
      base.names = (this.db.query("SELECT nickname FROM players WHERE game_id=? ORDER BY joined_at ASC LIMIT 300").all(g.id) as { nickname: string }[]).map((x) => x.nickname);
    }
    if (g.mode === "self" && (g.phase === "running" || g.phase === "final")) base.board = this.board(g);
    if (g.phase !== "lobby" && g.phase !== "final" && g.phase !== "running") {
      base.round = this.publicRound(g, g.phase !== "scene");
      if (g.phase === "scene") base.scene = (this.gameRounds(g)[g.round_idx] as Round).scene;
    }
    if (g.phase === "reveal" || g.phase === "leaderboard") base.reveal = this.revealBlock(g);
    if (g.phase === "leaderboard") {
      base.leaderboard = this.standings(g, g.round_idx)
        .slice(0, 5)
        .map((s) => ({ name: s.nickname, total: s.total, delta: s.delta, rank: s.rank }));
    }
    if (g.phase === "final") {
      const st = this.standings(g, null);
      base.podium = st.slice(0, 3).map((s) => ({ name: s.nickname, total: s.total, rank: s.rank }));
      base.top5 = st.slice(0, 5).map((s) => ({ name: s.nickname, total: s.total, rank: s.rank }));
    }
    return base;
  }

  playerState(tokenIn: unknown, since?: number): Record<string, unknown> {
    const p = this.playerByToken(tokenIn);
    const now = this.now();
    this.seen.set(p.token, now);
    this.tick();
    const g = this.gameById(p.game_id) as GameRow;
    if (since !== undefined && since === g.version && g.phase !== "question") return { ok: true, same: true, version: g.version, now };
    if (g.mode === "self") return this.selfPlayerState(p, g, now);
    const mine = (this.db.query("SELECT * FROM answers WHERE token=? AND round_idx=?").get(p.token, g.round_idx) as AnswerRow | null) ?? null;
    const out: Record<string, unknown> = {
      ok: true,
      version: g.version,
      now,
      name: p.nickname,
      lang: p.lang,
      meta: { title: this.content.meta.title, hospital: this.content.meta.hospital },
      game: { mode: g.mode, phase: g.phase, round: g.round_idx, rounds: this.gameRounds(g).length, active: g.status === "active", ...this.timing(g) },
    };
    if (g.mode === "phones" && (g.phase === "scene" || g.phase === "question")) out.scene = (this.gameRounds(g)[g.round_idx] as Round).scene;
    if (g.mode === "phones" && g.phase === "reveal") out.detail = this.feedbackDetail(this.gameRounds(g)[g.round_idx] as Round);
    if (g.phase === "lobby") {
      out.players = (this.db.query("SELECT COUNT(*) AS n FROM players WHERE game_id=?").get(g.id) as { n: number }).n;
    }
    if (g.phase === "scene") out.round = this.publicRound(g, false);
    if (g.phase === "question") {
      out.round = this.publicRound(g, true);
      out.answer = mine ? { key: mine.option_key } : null; // own choice only, never anything about correctness
    }
    if (g.phase === "reveal" || g.phase === "leaderboard") {
      out.round = this.publicRound(g, true);
      const r = this.gameRounds(g)[g.round_idx] as Round;
      const best = r.options.find((o) => o.score === 1000);
      const opt = mine ? r.options.find((o) => o.key === mine.option_key) : undefined;
      out.best = best ? { key: best.key, text: best.text } : null;
      out.result = mine && opt
        ? {
            key: mine.option_key,
            outcome: outcomeOf(opt.score, mine.knockout === 1),
            points: mine.points,
            base: mine.base,
            bonus: mine.bonus,
            knockout: mine.knockout === 1,
            feedback: opt.feedback,
          }
        : { key: null, outcome: "none", points: 0, base: 0, bonus: 0, knockout: false, feedback: null };
      if (!mine) out.result = { ...(out.result as object), bestFeedback: best?.feedback ?? null };
    }
    if (g.phase === "leaderboard" || g.phase === "final") {
      const st = this.standings(g, g.phase === "final" ? null : g.round_idx);
      const me = st.find((s) => s.token === p.token);
      out.rank = me ? { rank: me.rank, of: st.length, total: me.total, delta: me.delta, knockouts: me.knockouts } : null;
      if (g.phase === "final") out.podium = st.slice(0, 3).map((s) => ({ name: s.nickname, total: s.total, rank: s.rank }));
    }
    return out;
  }

  private feedbackDetail(r: Round) {
    return { why: r.why, standards: r.standards, realCase: r.realCase };
  }

  /** Same shape as the facilitator-paced state, but phase and round are the player's own. */
  private selfPlayerState(p: PlayerRow, g: GameRow, now: number): Record<string, unknown> {
    const rounds = this.gameRounds(g);
    const idx = Math.min(p.self_round, rounds.length - 1);
    const phase: Phase | "done" = g.phase === "running" ? (p.self_step === "done" ? "done" : p.self_step) : g.phase;
    const out: Record<string, unknown> = {
      ok: true,
      version: g.version,
      now,
      name: p.nickname,
      lang: p.lang,
      meta: { title: this.content.meta.title, hospital: this.content.meta.hospital },
      game: { mode: g.mode, phase, round: idx, rounds: rounds.length, active: g.status === "active" },
    };
    const r = rounds[idx] as Round;
    if (phase === "lobby") out.players = (this.db.query("SELECT COUNT(*) AS n FROM players WHERE game_id=?").get(g.id) as { n: number }).n;
    if (phase === "scene") {
      out.round = this.publicRound(g, false, idx);
      out.scene = r.scene;
    }
    if (phase === "question") {
      out.round = this.publicRound(g, true, idx);
      out.scene = r.scene;
      out.answer = null;
    }
    if (phase === "reveal") {
      const mine = this.db.query("SELECT * FROM answers WHERE token=? AND round_idx=?").get(p.token, idx) as AnswerRow;
      const opt = r.options.find((o) => o.key === mine.option_key) as Round["options"][number];
      const best = r.options.find((o) => o.score === 1000);
      out.round = this.publicRound(g, true, idx);
      out.best = best ? { key: best.key, text: best.text } : null;
      out.result = { key: mine.option_key, outcome: outcomeOf(opt.score, mine.knockout === 1), points: mine.points, base: mine.base, bonus: 0, knockout: mine.knockout === 1, feedback: opt.feedback };
      out.detail = this.feedbackDetail(r);
    }
    if (phase === "done" || phase === "final") {
      const st = this.standings(g, null);
      const me = st.find((s) => s.token === p.token);
      out.rank = me ? { rank: me.rank, of: st.length, total: me.total, delta: 0, knockouts: me.knockouts } : null;
      if (phase === "final") out.podium = st.slice(0, 3).map((s) => ({ name: s.nickname, total: s.total, rank: s.rank }));
    }
    return out;
  }

  // ---------- report ----------
  report(tokenIn: unknown): Record<string, unknown> {
    const p = this.playerByToken(tokenIn);
    const g = this.gameById(p.game_id) as GameRow;
    if (this.now() - g.created_at > REPORT_DAYS * 86_400_000) throw new HttpError(410, "This report has expired");
    const selfDone = g.mode === "self" && p.self_step === "done";
    // Self-paced: never show a round this player has not reached, unless the facilitator has ended the exercise.
    const revealed = g.mode === "self" && g.phase !== "final" ? (selfDone ? this.gameRounds(g).length : p.self_round + (p.self_step === "reveal" ? 1 : 0)) : this.revealedCount(g);
    const answers = new Map(
      (this.db.query("SELECT * FROM answers WHERE token=?").all(p.token) as AnswerRow[]).map((a) => [a.round_idx, a]),
    );
    const st = this.standings(g, null);
    const me = st.find((s) => s.token === p.token);
    const rounds = this.gameRounds(g).slice(0, revealed).map((r, i) => {
      const a = answers.get(i);
      const best = r.options.find((o) => o.score === 1000);
      const opt = a ? r.options.find((o) => o.key === a.option_key) : undefined;
      return {
        index: i,
        id: r.id,
        clock: r.clock,
        place: r.place,
        title: r.title,
        question: r.question,
        options: r.options.map((o) => ({ key: o.key, text: o.text, knockout: o.knockout, score: o.score })),
        best: best ? { key: best.key, text: best.text } : null,
        answered: !!a,
        joinedAfter: i < p.join_round,
        yourKey: a?.option_key ?? null,
        outcome: a && opt ? outcomeOf(opt.score, a.knockout === 1) : "none",
        points: a?.points ?? 0,
        bonus: a?.bonus ?? 0,
        knockout: a?.knockout === 1,
        feedback: opt?.feedback ?? null,
        why: r.why,
        standards: r.standards,
        realCase: r.realCase,
      };
    });
    return {
      ok: true,
      name: p.nickname,
      lang: p.lang,
      meta: this.content.meta,
      finished: g.phase === "final" || selfDone,
      total: me?.total ?? 0,
      rank: me?.rank ?? null,
      of: st.length,
      knockouts: me?.knockouts ?? 0,
      roundsTotal: this.gameRounds(g).length,
      expires: g.created_at + REPORT_DAYS * 86_400_000,
      rounds,
    };
  }
}
