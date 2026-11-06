import type { Option } from "./content.ts";

export const MAX_SPEED_BONUS = 500;

export interface Scored {
  base: number;
  bonus: number;
  points: number;
  knockout: boolean;
}

/**
 * Option score plus a speed bonus (up to 500, linear in remaining time) for options that
 * score above zero. Knock-out options always score 0 and are counted separately.
 */
export function scoreAnswer(opt: Pick<Option, "score" | "knockout">, remainingMs: number, totalMs: number): Scored {
  if (opt.knockout) return { base: 0, bonus: 0, points: 0, knockout: true };
  const base = Math.max(0, Math.round(opt.score));
  if (base <= 0 || totalMs <= 0) return { base, bonus: 0, points: base, knockout: false };
  const frac = Math.min(1, Math.max(0, remainingMs / totalMs));
  const bonus = Math.round(MAX_SPEED_BONUS * frac);
  return { base, bonus, points: base + bonus, knockout: false };
}

export function outcomeOf(score: number, knockout: boolean): "best" | "partly" | "wrong" | "knockout" {
  if (knockout) return "knockout";
  if (score >= 1000) return "best";
  if (score > 0) return "partly";
  return "wrong";
}
