import { expect, test } from "bun:test";
import { loadContent } from "../src/content.ts";
import { Engine } from "../src/game.ts";
import { EXAMPLE, makeEngine } from "./helpers.ts";

test("game, players, answers and phase survive a new Engine on the same db file", () => {
  const { engine, dbPath, t } = makeEngine();
  const g = engine.createGame();
  const a = engine.join({ code: g.code, nickname: "Ana", lang: "ar" });
  const b = engine.join({ code: g.code, nickname: "Ben" });
  engine.advance();
  engine.advance();
  t.now += 5_000;
  engine.answer(a.token, "A");
  const versionBefore = engine.activeGame()!.version;
  engine.close();

  const { content } = loadContent(EXAMPLE);
  const e2 = new Engine(dbPath, content, () => t.now);
  const g2 = e2.activeGame()!;
  expect(g2.id).toBe(g.id);
  expect(g2.code).toBe(g.code);
  expect(g2.phase).toBe("question");
  expect(g2.version).toBe(versionBefore);
  const st = e2.playerState(a.token) as any;
  expect(st.name).toBe("Ana");
  expect(st.lang).toBe("ar");
  expect(st.answer).toEqual({ key: "A" });
  // the other player can still answer and trigger the reveal
  expect(e2.answer(b.token, "D").locked).toBe(true);
  expect(e2.activeGame()!.phase).toBe("reveal");
  const host = e2.hostState("http://x") as any;
  expect(host.reveal.options.find((o: any) => o.key === "A").count).toBe(1);
  e2.close();
});

test("version only changes when something changes (cheap polling)", () => {
  const { engine } = makeEngine();
  const g = engine.createGame();
  const a = engine.join({ code: g.code, nickname: "Ana" });
  const v = (engine.playerState(a.token) as any).version;
  expect((engine.playerState(a.token, v) as any).same).toBe(true);
  engine.join({ code: g.code, nickname: "Ben" });
  expect((engine.playerState(a.token, v) as any).same).toBeUndefined();
});
