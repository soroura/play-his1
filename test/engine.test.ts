import { describe, expect, test } from "bun:test";
import { Engine, HttpError, sanitizeNickname } from "../src/game.ts";
import { makeEngine } from "./helpers.ts";

function setup() {
  const s = makeEngine();
  const g = s.engine.createGame();
  const join = (name: string, lang = "en", extra: object = {}) => s.engine.join({ code: g.code, nickname: name, lang, ...extra });
  const toQuestion = () => {
    s.engine.advance(); // scene
    s.engine.advance(); // question
  };
  return { ...s, g, join, toQuestion };
}
const phase = (e: Engine) => e.activeGame()!.phase;

describe("state machine", () => {
  test("lobby -> (scene, question, reveal, leaderboard) x2 -> final", () => {
    const { engine } = setup();
    const seq: string[] = [phase(engine)];
    for (let i = 0; i < 10; i++) {
      engine.advance();
      seq.push(phase(engine) + ":" + engine.activeGame()!.round_idx);
    }
    expect(seq).toEqual([
      "lobby",
      "scene:0", "question:0", "reveal:0", "leaderboard:0",
      "scene:1", "question:1", "reveal:1", "leaderboard:1",
      "final:1", "final:1",
    ]);
  });

  test("advance with a stale 'from' guard is a no-op", () => {
    const { engine } = setup();
    engine.advance("lobby:0");
    engine.advance("lobby:0");
    expect(phase(engine)).toBe("scene");
  });

  test("question auto-closes at the time limit", () => {
    const { engine, t, join, toQuestion } = setup();
    join("Ana");
    toQuestion();
    t.now += 39_000;
    engine.tick();
    expect(phase(engine)).toBe("question");
    t.now += 2_000;
    engine.tick();
    expect(phase(engine)).toBe("reveal");
  });

  test("extend adds 15 s; reveal closes early", () => {
    const { engine, t, join, toQuestion } = setup();
    join("Ana");
    toQuestion();
    engine.extend();
    t.now += 50_000;
    engine.tick();
    expect(phase(engine)).toBe("question");
    engine.reveal();
    expect(phase(engine)).toBe("reveal");
    expect(() => engine.extend()).toThrow(HttpError);
  });

  test("auto-closes when all connected players answered", () => {
    const { engine, join, toQuestion } = setup();
    const a = join("Ana");
    const b = join("Ben");
    toQuestion();
    engine.answer(a.token, "A");
    expect(phase(engine)).toBe("question");
    engine.answer(b.token, "B");
    expect(phase(engine)).toBe("reveal");
  });

  test("a creating a new game closes the old one", () => {
    const { engine, g } = setup();
    const g2 = engine.createGame();
    expect(g2.id).not.toBe(g.id);
    expect(engine.activeGame()!.id).toBe(g2.id);
  });
});

describe("players", () => {
  test("nickname rules: trim, 20 chars, unique with numbers", () => {
    expect(sanitizeNickname("  Ahmed   Ali \n")).toBe("Ahmed Ali");
    expect(sanitizeNickname("x".repeat(40)).length).toBe(20);
    const { join } = setup();
    expect(join("Sam").nickname).toBe("Sam");
    expect(join("sam").nickname).toBe("sam 2");
    expect(join("SAM").nickname).toBe("SAM 3");
    expect(join("y".repeat(20)).nickname).toBe("y".repeat(20));
    expect(join("y".repeat(20)).nickname).toBe("y".repeat(18) + " 2");
  });

  test("bad code, empty nickname", () => {
    const { engine, g } = setup();
    expect(() => engine.join({ code: "0000x", nickname: "A" })).toThrow(HttpError);
    expect(() => engine.join({ code: g.code, nickname: "   " })).toThrow(HttpError);
    const wrong = g.code === "1234" ? "4321" : "1234";
    expect(() => engine.join({ code: wrong, nickname: "A" })).toThrow(/Room not found/);
  });

  test("rejoin by token restores the same player without a code", () => {
    const { engine, join } = setup();
    const a = join("Ana", "ar");
    const again = engine.join({ token: a.token });
    expect(again.rejoined).toBe(true);
    expect(again.nickname).toBe("Ana");
    expect(again.lang).toBe("ar");
    expect(engine.playerState(a.token).name).toBe("Ana");
  });

  test("an old token does not hijack a new game's invite link", () => {
    const { engine, join } = setup();
    const old = join("Ana");
    const g2 = engine.createGame(); // closes the first game
    expect(() => engine.join({ token: old.token })).toThrow(/ended/);
    const fresh = engine.join({ token: old.token, code: g2.code, nickname: "Ana", lang: "en" });
    expect(fresh.rejoined).toBe(false);
    expect(fresh.token).not.toBe(old.token);
    // and the same token + matching code still rejoins
    expect(engine.join({ token: fresh.token, code: g2.code }).rejoined).toBe(true);
  });

  test("unknown token is a 404", () => {
    const { engine } = setup();
    expect(() => engine.playerState("0".repeat(32))).toThrow(/Unknown player/);
    expect(() => engine.playerState("nope")).toThrow(HttpError);
  });

  test("late join lands on the current round and can answer", () => {
    const { engine, join, toQuestion } = setup();
    join("Early");
    toQuestion();
    const late = join("Late");
    const st = engine.playerState(late.token) as any;
    expect(st.game.phase).toBe("question");
    expect(st.round.index).toBe(0);
    expect(engine.answer(late.token, "A").locked).toBe(true);
  });

  test("cannot join a finished game", () => {
    const { engine, join } = setup();
    for (let i = 0; i < 9; i++) engine.advance();
    expect(phase(engine)).toBe("final");
    expect(() => join("TooLate")).toThrow(/finished/);
  });
});

describe("answers", () => {
  test("one locked answer: second answer is ignored, first wins", () => {
    const { engine, join, toQuestion } = setup();
    const a = join("Ana");
    join("Ben");
    toQuestion();
    expect(engine.answer(a.token, "B").key).toBe("B");
    expect(engine.answer(a.token, "A").key).toBe("B");
    const n = engine.db.query("SELECT COUNT(*) AS n FROM answers WHERE token=?").get(a.token) as { n: number };
    expect(n.n).toBe(1);
    expect((engine.playerState(a.token) as any).answer).toEqual({ key: "B" });
  });

  test("answers rejected outside question phase, after the deadline, or with a bad key", () => {
    const { engine, t, join, toQuestion } = setup();
    const a = join("Ana");
    join("Ben");
    expect(() => engine.answer(a.token, "A")).toThrow(/No question/);
    toQuestion();
    expect(() => engine.answer(a.token, "Z")).toThrow(/Unknown option/);
    t.now += 45_000;
    expect(() => engine.answer(a.token, "A")).toThrow(/Time is up/);
  });

  test("scoring: best + speed bonus, knock-out 0 and counted", () => {
    const { engine, t, join, toQuestion } = setup();
    const a = join("Fast");
    const b = join("Slow");
    const c = join("Risky");
    toQuestion(); // limit 40 s
    t.now += 10_000; // 30 s left of 40 -> bonus 375
    engine.answer(a.token, "A");
    t.now += 20_000; // 10 s left -> 125
    engine.playerState(c.token); // c keeps polling, so stays "connected"
    engine.answer(b.token, "A");
    engine.answer(c.token, "B"); // knockout
    expect(phase(engine)).toBe("reveal");
    const ra = (engine.playerState(a.token) as any).result;
    expect(ra.points).toBe(1375);
    expect(ra.outcome).toBe("best");
    const rb = (engine.playerState(b.token) as any).result;
    expect(rb.points).toBe(1125);
    const rc = (engine.playerState(c.token) as any).result;
    expect(rc.points).toBe(0);
    expect(rc.knockout).toBe(true);
    expect(rc.outcome).toBe("knockout");
    const rep = engine.report(c.token) as any;
    expect(rep.knockouts).toBe(1);
  });

  test("leaderboard top 5, ranks and deltas", () => {
    const { engine, t, join, toQuestion } = setup();
    const toks = Array.from({ length: 7 }, (_, i) => join("P" + i).token);
    toQuestion();
    toks.forEach((tok, i) => {
      t.now += 1000;
      engine.answer(tok, i === 6 ? "B" : "A");
    });
    engine.advance(); // leaderboard (already revealed automatically -> advance goes to leaderboard)
    const host = engine.hostState("http://x") as any;
    expect(host.game.phase).toBe("leaderboard");
    expect(host.leaderboard.length).toBe(5);
    expect(host.leaderboard[0].name).toBe("P0");
    expect(host.leaderboard[0].rank).toBe(1);
    const mine = (engine.playerState(toks[6]!) as any).rank;
    expect(mine.rank).toBe(7);
    expect(mine.of).toBe(7);
  });
});

describe("no leakage before reveal", () => {
  test("player state during scene and question never carries answers", () => {
    const { engine, content, join, toQuestion } = setup();
    const a = join("Ana");
    join("Ben");
    const forbidden: string[] = [];
    for (const r of content.rounds) {
      for (const o of r.options) forbidden.push(o.feedback.en);
      for (const w of r.why) forbidden.push(w.text.en);
      forbidden.push(r.realCase.text as string);
    }
    const check = () => {
      const s = JSON.stringify(engine.playerState(a.token));
      for (const f of forbidden) expect(s).not.toContain(f);
      for (const k of ['"score"', '"knockout"', '"best"', '"feedback"', '"why"', '"realCase"', '"standards"', '"count"']) expect(s).not.toContain(k);
    };
    check(); // lobby
    engine.advance();
    check(); // scene
    engine.advance();
    check(); // question
    engine.answer(a.token, "A");
    check(); // question, after own answer: still nothing about correctness
  });

  test("host state during question has no distribution or best option", () => {
    const { engine, join, toQuestion } = setup();
    const a = join("Ana");
    join("Ben");
    toQuestion();
    engine.answer(a.token, "A");
    const s = JSON.stringify(engine.hostState("http://x"));
    for (const k of ['"score"', '"knockout"', '"best"', '"feedback"', '"why"', '"realCase"', '"count"', '"reveal"']) expect(s).not.toContain(k);
    expect((engine.hostState("http://x") as any).answered).toBe(1);
  });

  test("report only contains rounds already revealed", () => {
    const { engine, join, toQuestion } = setup();
    const a = join("Ana");
    join("Ben");
    toQuestion();
    engine.answer(a.token, "A");
    expect(phase(engine)).toBe("question");
    expect((engine.report(a.token) as any).rounds.length).toBe(0);
    engine.reveal();
    const rep = engine.report(a.token) as any;
    expect(rep.rounds.length).toBe(1);
    expect(rep.rounds[0].yourKey).toBe("A");
    expect(rep.rounds[0].best.key).toBe("A");
  });

  test("report expires after 14 days", () => {
    const { engine, t, join } = setup();
    const a = join("Ana");
    t.now += 15 * 86_400_000;
    expect(() => engine.report(a.token)).toThrow(/expired/);
  });
});
