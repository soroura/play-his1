import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { Engine, HttpError } from "../src/game.ts";
import { loadContent } from "../src/content.ts";
import { EXAMPLE, makeEngineMany, tmpDb } from "./helpers.ts";

function playThrough(engine: Engine, t: { now: number }, token: string) {
  const seen: number[] = [];
  let guard = 0;
  while (engine.activeGame()!.phase !== "final" && guard++ < 100) {
    const g = engine.activeGame()!;
    if (g.phase === "question") {
      seen.push((engine.playerState(token) as any).round.id);
      t.now += 3_000;
      engine.answer(token, "A");
    } else engine.advance();
  }
  return seen;
}

describe("round selection", () => {
  test("default is every core round, stored on the game", () => {
    const { engine } = makeEngineMany();
    const g = engine.createGame();
    expect(JSON.parse(g.round_ids!)).toEqual([1, 2]);
    expect((engine.hostState("http://x") as any).game.rounds).toBe(2);
  });

  test("explicit ids are deduplicated and kept in content order", () => {
    const { engine } = makeEngineMany();
    const g = engine.createGame([4, 1, 4, 3]);
    expect(JSON.parse(g.round_ids!)).toEqual([1, 3, 4]);
    expect((engine.hostState("http://x") as any).game.roundIds).toEqual([1, 3, 4]);
  });

  test("invalid selections are 400", () => {
    const { engine } = makeEngineMany();
    for (const bad of [[], [99], [1, 99], ["1"], [1.5], "1", {}, [null]]) {
      try {
        engine.createGame(bad);
        throw new Error("should have thrown for " + JSON.stringify(bad));
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        expect((e as HttpError).status).toBe(400);
      }
    }
    expect(engine.activeGame()).toBeNull(); // a rejected request leaves no game behind
  });

  test("a subset game runs to final and reports only its rounds", () => {
    const { engine, t } = makeEngineMany();
    const g = engine.createGame([2, 4]);
    const p = engine.join({ code: g.code, nickname: "Ana" });
    engine.advance(); // scene
    const seen = playThrough(engine, t, p.token);
    expect(seen).toEqual([2, 4]);
    const hs = engine.hostState("http://x") as any;
    expect(hs.game.phase).toBe("final");
    expect(hs.game.rounds).toBe(2);
    const ps = engine.playerState(p.token) as any;
    expect(ps.game.rounds).toBe(2);
    const rep = engine.report(p.token) as any;
    expect(rep.roundsTotal).toBe(2);
    expect(rep.rounds.map((r: any) => r.id)).toEqual([2, 4]);
    expect(rep.rounds.map((r: any) => r.index)).toEqual([0, 1]);
    expect(rep.total).toBeGreaterThan(0);
  });

  test("a single-round game goes leaderboard -> final", () => {
    const { engine, t } = makeEngineMany();
    const g = engine.createGame([3]);
    const p = engine.join({ code: g.code, nickname: "Ana" });
    engine.advance();
    expect(playThrough(engine, t, p.token)).toEqual([3]);
    expect(engine.activeGame()!.phase).toBe("final");
  });

  test("selection survives a restart", () => {
    const { engine, dbPath } = makeEngineMany();
    engine.createGame([2, 3]);
    engine.close();
    const { content } = makeEngineMany(tmpDb());
    const e2 = new Engine(dbPath, content);
    expect((e2.hostState("http://x") as any).game.roundIds).toEqual([2, 3]);
    e2.close();
  });
});

describe("migration", () => {
  test("a database created with the old schema gets round_ids and old games play all core rounds", () => {
    const dbPath = tmpDb();
    const old = new Database(dbPath, { create: true });
    old.exec(`
CREATE TABLE games(id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', phase TEXT NOT NULL,
  round_idx INTEGER NOT NULL DEFAULT 0, phase_started INTEGER NOT NULL, deadline INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE TABLE players(token TEXT PRIMARY KEY, game_id INTEGER NOT NULL, nickname TEXT NOT NULL, lang TEXT NOT NULL, joined_at INTEGER NOT NULL, join_round INTEGER NOT NULL DEFAULT 0);
CREATE TABLE answers(game_id INTEGER NOT NULL, token TEXT NOT NULL, round_idx INTEGER NOT NULL, option_key TEXT NOT NULL, answered_at INTEGER NOT NULL,
  points INTEGER NOT NULL, base INTEGER NOT NULL, bonus INTEGER NOT NULL, knockout INTEGER NOT NULL, PRIMARY KEY(token, round_idx));
INSERT INTO games(code,status,phase,round_idx,phase_started,deadline,version,created_at) VALUES('4321','active','scene',1,1800000000000,0,7,1800000000000);
INSERT INTO players(token,game_id,nickname,lang,joined_at,join_round) VALUES('${"a".repeat(32)}',1,'Old',  'en',1800000000000,0);
`);
    old.close();
    for (let i = 0; i < 2; i++) {
      // second pass: migration is idempotent
      const { content } = loadContent(EXAMPLE);
      const e = new Engine(dbPath, content, () => 1_800_000_000_000);
      const cols = (e.db.query("PRAGMA table_info(games)").all() as { name: string }[]).map((c) => c.name);
      expect(cols.filter((c) => c === "round_ids").length).toBe(1);
      const g = e.activeGame()!;
      expect(g.round_ids).toBeNull();
      expect(g.version).toBe(7);
      const hs = e.hostState("http://x") as any;
      expect(hs.game.rounds).toBe(2);
      expect(hs.game.round).toBe(1);
      expect((e.playerState("a".repeat(32)) as any).game.rounds).toBe(2);
      // new games on the migrated db store a selection
      if (i === 1) expect(e.createGame([1]).round_ids).toBe("[1]");
      e.close();
    }
  });
});
