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
