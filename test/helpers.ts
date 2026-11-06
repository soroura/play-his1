import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadContent } from "../src/content.ts";
import { Engine } from "../src/game.ts";

export const EXAMPLE = join(import.meta.dir, "..", "content", "rounds.example.json");
export const PUBLIC_DIR = join(import.meta.dir, "..", "public");

export function tmpDb(): string {
  return join(mkdtempSync(join(tmpdir(), "play-his1-")), "t.sqlite");
}

export function makeEngine(dbPath = tmpDb()) {
  const t = { now: 1_800_000_000_000 };
  const { content } = loadContent(EXAMPLE);
  const engine = new Engine(dbPath, content, () => t.now);
  return { engine, t, dbPath, content };
}

/** Engine over a content variant: the example rounds plus clones with ids 3 and 4 marked "extra". */
export function makeEngineMany(dbPath = tmpDb()) {
  const t = { now: 1_800_000_000_000 };
  const { content } = loadContent(EXAMPLE);
  const c3 = { ...structuredClone(content.rounds[0]!), id: 3, set: "extra" as const, minutes: 5 };
  const c4 = { ...structuredClone(content.rounds[1]!), id: 4, set: "extra" as const, minutes: 6 };
  const many = { ...content, rounds: [...content.rounds, c3, c4] };
  const engine = new Engine(dbPath, many, () => t.now);
  return { engine, t, dbPath, content: many };
}
