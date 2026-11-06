import { describe, expect, test } from "bun:test";
import { outcomeOf, scoreAnswer } from "../src/scoring.ts";

describe("scoring", () => {
  test("best answer, instant, gets 1000 + 500", () => {
    expect(scoreAnswer({ score: 1000, knockout: false }, 45000, 45000).points).toBe(1500);
  });
  test("speed bonus is linear in remaining time", () => {
    expect(scoreAnswer({ score: 1000, knockout: false }, 22500, 45000).bonus).toBe(250);
    expect(scoreAnswer({ score: 1000, knockout: false }, 0, 45000).points).toBe(1000);
  });
  test("partly right gets bonus too", () => {
    expect(scoreAnswer({ score: 400, knockout: false }, 45000, 45000).points).toBe(900);
  });
  test("zero score gets no bonus", () => {
    expect(scoreAnswer({ score: 0, knockout: false }, 45000, 45000)).toEqual({ base: 0, bonus: 0, points: 0, knockout: false });
  });
  test("knock-out always scores 0 and is flagged, even with a score set", () => {
    expect(scoreAnswer({ score: 400, knockout: true }, 45000, 45000)).toEqual({ base: 0, bonus: 0, points: 0, knockout: true });
  });
  test("outcomes", () => {
    expect(outcomeOf(1000, false)).toBe("best");
    expect(outcomeOf(400, false)).toBe("partly");
    expect(outcomeOf(0, false)).toBe("wrong");
    expect(outcomeOf(0, true)).toBe("knockout");
  });
});
