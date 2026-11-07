import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Engine, HttpError } from "../src/game.ts";
import { loadContent } from "../src/content.ts";
import { hashPin, makeHostToken, verifyHostToken } from "../src/security.ts";
import { createServer } from "../src/server.ts";
import { EXAMPLE, PUBLIC_DIR, makeEngine, tmpDb } from "./helpers.ts";

const TRAINER = 7;

describe("facilitator rooms", () => {
  test("two facilitators run games at once without touching each other", () => {
    const { engine, t } = makeEngine();
    const a = engine.createGame();
    const b = engine.createGame(undefined, { owner: TRAINER });
    expect(engine.activeGame()!.id).toBe(a.id); // the second create did not close the first
    expect(engine.activeGame(TRAINER)!.id).toBe(b.id);
    expect(a.code).not.toBe(b.code);

    const pa = engine.join({ code: a.code, nickname: "Ana" });
    const pb = engine.join({ code: b.code, nickname: "Ben" });
    engine.advance("lobby:0", TRAINER);
    expect(engine.activeGame()!.phase).toBe("lobby");
    expect(engine.activeGame(TRAINER)!.phase).toBe("scene");
    expect((engine.playerState(pa.token) as any).game.phase).toBe("lobby");
    expect((engine.playerState(pb.token) as any).game.phase).toBe("scene");
    expect((engine.hostState("http://x", undefined, TRAINER) as any).players.total).toBe(1);

    engine.advance("scene:0", TRAINER);
    engine.advance("lobby:0");
    engine.advance("scene:0");
    t.now += 3_600_000; // both questions time out, whichever game is the newest
    engine.tick();
    expect(engine.activeGame()!.phase).toBe("reveal");
    expect(engine.activeGame(TRAINER)!.phase).toBe("reveal");

    engine.createGame(undefined, { owner: TRAINER }); // a new game replaces only the trainer's own
    expect(engine.activeGame()!.id).toBe(a.id);
  });

  test("a facilitator's new game ends only their old one, and its players land on the final screen", () => {
    const { engine } = makeEngine();
    const old = engine.createGame(undefined, { owner: TRAINER });
    const p = engine.join({ code: old.code, nickname: "Ana" });
    engine.advance("lobby:0", TRAINER);
    engine.createGame(undefined, { owner: TRAINER });
    const st = engine.playerState(p.token) as any;
    expect(st.game.phase).toBe("final");
    expect(st.game.active).toBe(false);
    expect((engine.report(p.token) as any).ok).toBe(true);
  });

  test("room codes stay unique across many open rooms", () => {
    const { engine } = makeEngine();
    const codes = new Set<string>();
    for (let owner = 0; owner < 400; owner++) codes.add(engine.createGame(undefined, { owner }).code);
    expect(codes.size).toBe(400);
  });

  test("adding, renaming clash, and removing: removal ends their room but keeps reports", () => {
    const { engine } = makeEngine();
    const f = engine.addFacilitator("  Amal  ", "h1");
    expect(f.name).toBe("Amal");
    expect(() => engine.addFacilitator("amal", "h2")).toThrow(/already/);
    expect(() => engine.addFacilitator("   ", "h3")).toThrow(HttpError);
    const g = engine.createGame(undefined, { owner: f.id, mode: "self" });
    const p = engine.join({ code: g.code, nickname: "Ana" });
    const team = engine.team() as any;
    expect(team.facilitators[0]).toMatchObject({ name: "Amal", room: { code: g.code, mode: "self", players: 1 } });
    expect(JSON.stringify(team)).not.toContain("h1");
    engine.removeFacilitator(f.id);
    expect(engine.facilitator(f.id)).toBeNull();
    expect(engine.activeGame(f.id)).toBeNull();
    expect((engine.playerState(p.token) as any).game.phase).toBe("final");
    expect((engine.report(p.token) as any).ok).toBe(true);
    // ids are never reused, so an old cookie cannot become someone else
    expect(engine.addFacilitator("Omar", "h4").id).toBeGreaterThan(f.id);
  });

  test("a database from an earlier release keeps its game as the main facilitator's", () => {
    const path = tmpDb();
    const db = new Database(path, { create: true });
    db.exec(`CREATE TABLE games(id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', phase TEXT NOT NULL, round_idx INTEGER NOT NULL DEFAULT 0, phase_started INTEGER NOT NULL, deadline INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, round_ids TEXT);
      CREATE TABLE players(token TEXT PRIMARY KEY, game_id INTEGER NOT NULL, nickname TEXT NOT NULL, lang TEXT NOT NULL, joined_at INTEGER NOT NULL, join_round INTEGER NOT NULL DEFAULT 0);
      INSERT INTO games(code,status,phase,round_idx,phase_started,created_at,round_ids) VALUES('5397','active','final',1,1,1800000000000,'[1,2]');
      INSERT INTO players VALUES('${"a".repeat(32)}',1,'Ana','en',1,0);`);
    db.close();
    const { content } = loadContent(EXAMPLE);
    const clock = () => 1_800_000_000_000;
    for (let i = 0; i < 2; i++) {
      const e = new Engine(path, content, clock); // twice: the migration must be repeatable
      expect(e.activeGame()!.code).toBe("5397");
      expect(e.activeGame()!.mode).toBe("screen");
      const st = e.playerState("a".repeat(32)) as any;
      expect(st.game).toMatchObject({ phase: "final", mode: "screen" });
      expect((e.report("a".repeat(32)) as any).rounds.length).toBe(2);
      e.close();
    }
  });
});

describe("host token", () => {
  const keyOf = (id: number) => (id === 0 ? "main" : id === 3 ? "k3" : null);
  test("carries the id and fails when tampered with, expired, re-keyed or removed", () => {
    const s = "s".repeat(32);
    const tok = makeHostToken(s, 3, "k3", 1000);
    expect(verifyHostToken(s, tok, keyOf, 2000)).toBe(3);
    expect(verifyHostToken(s, tok.replace(/^3\./, "0."), keyOf, 2000)).toBeNull(); // cannot promote itself to main
    expect(verifyHostToken(s, tok, keyOf, 1000 + 13 * 3600 * 1000)).toBeNull();
    expect(verifyHostToken(s, tok, (id) => (id === 3 ? "new-pin" : null), 2000)).toBeNull();
    expect(verifyHostToken(s, tok, () => null, 2000)).toBeNull();
    expect(verifyHostToken("t".repeat(32), tok, keyOf, 2000)).toBeNull();
    for (const bad of ["", "abc", "3.1.2", "x.y.z", `3.1e9.${"a".repeat(64)}`]) expect(verifyHostToken(s, bad, keyOf, 2000)).toBeNull();
  });
});

describe("mode setting", () => {
  test("defaults to the shared screen, and refuses unknown modes", () => {
    const { engine } = makeEngine();
    expect(engine.createGame().mode).toBe("screen");
    expect(() => engine.createGame(undefined, { mode: "banana" })).toThrow(/mode/);
    expect(engine.createGame(undefined, { mode: "phones" }).mode).toBe("phones");
  });

  test("shared screen: phones get no scene and no extra feedback (unchanged)", () => {
    const { engine } = makeEngine();
    const g = engine.createGame();
    const p = engine.join({ code: g.code, nickname: "Ana" });
    engine.advance("lobby:0");
    expect((engine.playerState(p.token) as any).scene).toBeUndefined();
    engine.advance("scene:0");
    expect((engine.playerState(p.token) as any).scene).toBeUndefined();
    engine.reveal();
    expect((engine.playerState(p.token) as any).detail).toBeUndefined();
  });

  test("phones, facilitator pace: scene and full feedback reach phones; timer and bonus stay", () => {
    const { engine, t } = makeEngine();
    const g = engine.createGame(undefined, { mode: "phones" });
    const a = engine.join({ code: g.code, nickname: "Ana" });
    const b = engine.join({ code: g.code, nickname: "Ben" });
    engine.advance("lobby:0");
    const sc = engine.playerState(a.token) as any;
    expect(sc.game.phase).toBe("scene");
    expect(sc.scene.lines.length).toBeGreaterThan(0);
    engine.advance("scene:0");
    const q = engine.playerState(a.token) as any;
    expect(q.scene.lines.length).toBeGreaterThan(0);
    expect(q.game.remainingMs).toBeGreaterThan(0);
    for (const secret of ["feedback", "score", "why", "realCase"]) expect(JSON.stringify(q)).not.toContain(secret);
    t.now += 1000;
    engine.answer(a.token, "A");
    engine.answer(b.token, "D");
    const r = engine.playerState(a.token) as any;
    expect(r.game.phase).toBe("reveal");
    expect(r.result.bonus).toBeGreaterThan(0);
    expect(r.detail.why.length).toBeGreaterThan(0);
    expect(r.detail.realCase.title).toBeTruthy();
  });
});

describe("self-paced", () => {
  function setup() {
    const s = makeEngine();
    const g = s.engine.createGame(undefined, { mode: "self" });
    return { ...s, g, join: (n: string) => s.engine.join({ code: g.code, nickname: n }) };
  }
  const state = (e: Engine, tok: string) => e.playerState(tok) as any;

  test("each player moves alone; no clock, no bonus; feedback on the phone", () => {
    const { engine, t, join } = setup();
    const a = join("Ana");
    const b = join("Ben");
    expect(state(engine, a.token).game.phase).toBe("lobby");
    expect(() => engine.selfNext(a.token)).toThrow(/not open/);
    engine.advance("lobby:0");
    expect(engine.activeGame()!.phase).toBe("running");

    const sc = state(engine, a.token);
    expect(sc.game).toMatchObject({ mode: "self", phase: "scene", round: 0, rounds: 2 });
    expect(sc.scene.lines.length).toBeGreaterThan(0);
    expect(() => engine.answer(a.token, "A")).toThrow(/No question/);

    engine.selfNext(a.token, "scene:0");
    const q = state(engine, a.token);
    expect(q.game.phase).toBe("question");
    expect(q.game.remainingMs).toBeUndefined();
    for (const secret of ["feedback", "score", "why", "realCase"]) expect(JSON.stringify(q)).not.toContain(secret);
    expect(() => engine.selfNext(a.token)).toThrow(/Answer the question/);
    expect(state(engine, b.token).game.phase).toBe("scene"); // Ben has not moved

    t.now += 9_000_000; // no deadline: a long read costs nothing
    engine.tick();
    expect(state(engine, a.token).game.phase).toBe("question");
    expect(engine.answer(a.token, "A")).toEqual({ locked: true, key: "A" });
    expect(engine.answer(a.token, "D")).toEqual({ locked: true, key: "A" }); // first answer stands

    const r = state(engine, a.token);
    expect(r.game.phase).toBe("reveal");
    expect(r.result).toMatchObject({ key: "A", outcome: "best", points: 1000, bonus: 0 });
    expect(r.detail.why.length).toBeGreaterThan(0);
    expect(r.best.key).toBe("A");

    engine.selfNext(a.token, "reveal:0");
    engine.selfNext(a.token, "reveal:0"); // double tap on Next must not skip a round
    expect(state(engine, a.token).game).toMatchObject({ phase: "scene", round: 1 });
    expect(state(engine, b.token).game).toMatchObject({ phase: "scene", round: 0 });
  });

  test("the report never spoils a round the player has not reached", () => {
    const { engine, join } = setup();
    const a = join("Ana");
    engine.advance("lobby:0");
    expect((engine.report(a.token) as any).rounds.length).toBe(0);
    engine.selfNext(a.token);
    expect((engine.report(a.token) as any).rounds.length).toBe(0);
    engine.answer(a.token, "A");
    expect((engine.report(a.token) as any).rounds.length).toBe(1);
    engine.selfNext(a.token);
    engine.selfNext(a.token);
    engine.answer(a.token, engine.rounds[1]!.options[0]!.key);
    engine.selfNext(a.token);
    const st = state(engine, a.token);
    expect(st.game.phase).toBe("done");
    expect(st.rank.of).toBe(1);
    const rep = engine.report(a.token) as any;
    expect(rep.finished).toBe(true);
    expect(rep.rounds.length).toBe(2);
  });

  test("late joiners start at round 1; the board tracks everyone; End closes it for all", () => {
    const { engine, join } = setup();
    const a = join("Ana");
    engine.advance("lobby:0");
    engine.selfNext(a.token);
    engine.answer(a.token, "B"); // the knock-out in the example content
    engine.selfNext(a.token);
    const late = join("Late");
    expect(state(engine, late.token).game).toMatchObject({ phase: "scene", round: 0 });

    const hs = engine.hostState("http://x") as any;
    expect(hs.game.phase).toBe("running");
    expect(hs.board.total).toBe(2);
    expect(hs.board.people.find((p: any) => p.name === "Ana")).toMatchObject({ round: 2, step: "scene", knockouts: 1 });
    expect(hs.board.rounds[0]).toMatchObject({ answered: 1, best: 0, knockouts: 1 });
    expect(JSON.stringify(hs.board)).not.toContain(a.token);

    engine.advance("running:0");
    expect(state(engine, a.token).game.phase).toBe("final");
    expect(() => engine.selfNext(a.token)).toThrow(/not open/);
    expect(() => engine.answer(late.token, "A")).toThrow();
    expect((engine.report(late.token) as any).rounds.length).toBe(2); // ended: everything can be read
    expect((engine.hostState("http://x") as any).board.total).toBe(2);
  });

  test("a polling player sees other players' progress as a normal version change, and their own step after Next", () => {
    const { engine, join } = setup();
    const a = join("Ana");
    engine.advance("lobby:0");
    const v = state(engine, a.token).version;
    expect((engine.playerState(a.token, v) as any).same).toBe(true);
    engine.selfNext(a.token);
    const after = engine.playerState(a.token, v) as any;
    expect(after.same).toBeUndefined();
    expect(after.game.phase).toBe("question");
  });
});

describe("http: facilitators", () => {
  const ORIGIN = "https://play.example.test";
  let app: ReturnType<typeof createServer>;
  let base = "";
  const post = (path: string, body: unknown, cookie = "") =>
    fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const get = (path: string, cookie = "") => fetch(base + path, { headers: cookie ? { Cookie: cookie } : {} });
  const login = async (pin: string) => (await post("/api/host/login", { pin })).headers.get("set-cookie")!.split(";")[0]!;

  beforeAll(() => {
    const { engine } = makeEngine();
    app = createServer(engine, { port: 0, hostPin: "4321", secret: "x".repeat(32), origin: ORIGIN, publicDir: PUBLIC_DIR, sha: "t" });
    base = `http://127.0.0.1:${app.port}`;
  });
  afterAll(() => app.stop());

  test("full life of a facilitator: add, log in, own room, no team access, new PIN, remove", async () => {
    const main = await login("4321");
    expect((await get("/api/host/team")).status).toBe(401);
    expect(((await (await get("/api/host/state", main)).json()) as any).who).toEqual({ name: "Main facilitator", main: true });

    const added = (await (await post("/api/host/team/add", { name: "Amal" }, main)).json()) as any;
    expect(added.pin).toMatch(/^\d{8}$/);
    const raw = (await (await get("/api/host/team", main)).text());
    expect(raw).toContain("Amal");
    expect(raw).not.toContain(added.pin);
    expect(raw).not.toContain(hashPin("x".repeat(32), added.pin));

    const amal = await login(added.pin);
    const st = (await (await get("/api/host/state", amal)).json()) as any;
    expect(st.who).toEqual({ name: "Amal", main: false });
    expect(st.game).toBeNull();
    for (const [m, path, b] of [["get", "/api/host/team"], ["post", "/api/host/team/add", { name: "X" }], ["post", "/api/host/team/remove", { id: added.id }], ["post", "/api/host/team/pin", { id: added.id }]] as const) {
      const r = m === "get" ? await get(path, amal) : await post(path, b, amal);
      expect(r.status).toBe(403);
    }

    // own rooms, same time, and she can read the content and notes
    const mine = (await (await post("/api/host/game", { mode: "self" }, main)).json()) as any;
    const hers = (await (await post("/api/host/game", { mode: "phones" }, amal)).json()) as any;
    expect(mine.game.mode).toBe("self");
    expect(hers.game.mode).toBe("phones");
    expect(hers.game.code).not.toBe(mine.game.code);
    expect(((await (await get("/api/host/state", main)).json()) as any).game.id).toBe(mine.game.id);
    expect((await get("/api/host/content", amal)).status).toBe(200);
    expect((await post("/api/host/game", { mode: "nope" }, amal)).status).toBe(400);

    // a self-paced player over HTTP
    const j = (await (await post("/api/join", { code: mine.game.code, nickname: "Ana" })).json()) as any;
    await post("/api/host/advance", { from: "lobby:0" }, main);
    expect((await post("/api/next", { token: j.token, from: "scene:0" })).status).toBe(200);
    expect(((await (await get(`/api/state?token=${j.token}`)).json()) as any).game.phase).toBe("question");
    expect((await post("/api/next", { token: "0".repeat(32) })).status).toBe(404);
    const heardByHer = (await (await post("/api/join", { code: hers.game.code, nickname: "Ben" })).json()) as any;
    expect((await post("/api/next", { token: heardByHer.token })).status).toBe(409); // not a self-paced room

    // new PIN: old cookie and old PIN die, new PIN works
    const re = (await (await post("/api/host/team/pin", { id: added.id }, main)).json()) as any;
    expect(re.pin).not.toBe(added.pin);
    expect((await get("/api/host/state", amal)).status).toBe(401);
    expect((await post("/api/host/login", { pin: added.pin })).status).toBe(401);
    const amal2 = await login(re.pin);
    expect((await get("/api/host/state", amal2)).status).toBe(200);

    // remove: cookie dies at once, her room closes, mine runs on
    expect((await post("/api/host/team/remove", { id: added.id }, main)).status).toBe(200);
    expect((await get("/api/host/state", amal2)).status).toBe(401);
    expect((await post("/api/host/team/remove", { id: added.id }, main)).status).toBe(404);
    expect(((await (await get("/api/host/state", main)).json()) as any).game.phase).toBe("running");
    expect((await post("/api/join", { code: hers.game.code, nickname: "Late" })).status).toBe(404);
    expect((await get("/host/team")).status).toBe(200);
  });
});
