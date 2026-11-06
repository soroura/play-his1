import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContent, resolveContentFile } from "./content.ts";
import { Engine } from "./game.ts";
import { createServer } from "./server.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;
const production = env.NODE_ENV === "production";

const hostPin = env.HOST_PIN ?? "";
const secret = env.SESSION_SECRET ?? "";
if (production) {
  const problems: string[] = [];
  if (hostPin.length < 4) problems.push("HOST_PIN must be set (at least 4 characters)");
  if (secret.length < 24) problems.push("SESSION_SECRET must be set (at least 24 characters)");
  if (problems.length) {
    console.error("[play] refusing to start in production:\n  - " + problems.join("\n  - "));
    process.exit(1);
  }
} else if (!hostPin || !secret) {
  console.warn("[play] HOST_PIN or SESSION_SECRET missing: using insecure dev defaults (1234). Do not use in production.");
}

const origin = env.PUBLIC_ORIGIN ? env.PUBLIC_ORIGIN.replace(/\/+$/, "") : undefined;
const publicDir = join(root, "public");

let contentInfo;
try {
  const f = resolveContentFile(root, env.CONTENT_FILE);
  const { content, warnings } = loadContent(f.path, publicDir);
  contentInfo = { content, file: f.path, fallback: f.fallback, warnings };
} catch (e) {
  console.error("[play] cannot start: " + (e as Error).message);
  process.exit(1);
}
console.log(`[play] content: ${contentInfo.file}${contentInfo.fallback ? " (fallback example; rounds.json not found)" : ""}, ${contentInfo.content.rounds.length} rounds`);
for (const w of contentInfo.warnings) console.warn("[play] content warning: " + w);

let dbPath = env.PLAY_DB;
if (!dbPath) dbPath = join(env.DATA_DIR ?? join(root, "data"), "play.sqlite");
mkdirSync(dirname(resolve(dbPath)), { recursive: true });

const engine = new Engine(dbPath, contentInfo.content);
const port = Number(env.PORT ?? 8098);
const app = createServer(engine, {
  port,
  hostPin: hostPin || "1234",
  secret: secret || "dev-secret-not-for-production-0123456789",
  origin,
  publicDir,
  sha: env.RELEASE_SHA ?? "dev",
});
console.log(`[play] listening on :${app.port}  db=${dbPath}  origin=${origin ?? "(request origin)"}`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    app.stop();
    engine.close();
    process.exit(0);
  });
}
