import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer } from "../src/server.ts";
import { PUBLIC_DIR, makeEngine } from "./helpers.ts";

let app: ReturnType<typeof createServer>;
let base = "";
const ORIGIN = "https://play.example.test";
let cookie = "";

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers }, body: JSON.stringify(body) });
const host = (path: string, body?: unknown) =>
  body === undefined ? fetch(base + path, { headers: { Cookie: cookie } }) : post(path, body, { Cookie: cookie });

beforeAll(() => {
  const { engine } = makeEngine();
  app = createServer(engine, { port: 0, hostPin: "4321", secret: "x".repeat(32), origin: ORIGIN, publicDir: PUBLIC_DIR, sha: "abc123" });
  base = `http://127.0.0.1:${app.port}`;
});
afterAll(() => app.stop());

describe("http", () => {
  test("health", async () => {
    const r = await (await fetch(base + "/api/health")).json();
    expect(r).toEqual({ ok: true, sha: "abc123", rounds: 2 });
  });

  test("pages are served with security headers", async () => {
    for (const p of ["/", "/play", "/host", "/host/help", "/report/abcdef"]) {
      const r = await fetch(base + p);
      expect(r.status).toBe(200);
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.headers.get("content-security-policy")).toContain("default-src 'self'");
    }
    expect((await fetch(base + "/js/common.js")).status).toBe(200);
  });

  test("path traversal is blocked", async () => {
    for (const p of ["/../package.json", "/%2e%2e/package.json", "/..%2fpackage.json", "/js/../../src/main.ts", "/%00", "/src/main.ts", "/js/..%5c..%5cpackage.json"]) {
      const r = await fetch(base + p);
      expect([400, 404]).toContain(r.status);
    }
    const raw = await fetch(`${base}/..%2f..%2fetc/passwd`);
    expect([400, 404]).toContain(raw.status);
  });

  test("POST without matching Origin is refused", async () => {
    const r = await fetch(base + "/api/join", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.test" }, body: "{}" });
    expect(r.status).toBe(403);
    const r2 = await fetch(base + "/api/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(r2.status).toBe(403);
  });

  test("host endpoints need the cookie; wrong PIN is refused", async () => {
    expect((await fetch(base + "/api/host/state")).status).toBe(401);
    expect((await post("/api/host/game", {})).status).toBe(401);
    expect((await post("/api/host/login", { pin: "0000" })).status).toBe(401);
    const ok = await post("/api/host/login", { pin: "4321" });
    expect(ok.status).toBe(200);
    const sc = ok.headers.get("set-cookie")!;
    expect(sc).toContain("HttpOnly");
    expect(sc).toContain("SameSite=Lax");
    expect(sc).toContain("Secure");
    cookie = sc.split(";")[0]!;
    expect((await fetch(base + "/api/host/state", { headers: { Cookie: "play_host=forged.abc" } })).status).toBe(401);
  });

  test("full flow over HTTP: create, join, play, reveal, report", async () => {
    const created = (await (await host("/api/host/game", {})).json()) as any;
    expect(created.game.phase).toBe("lobby");
    expect(created.game.joinUrl).toBe(ORIGIN);
    const code = created.game.code as string;
    const j = (await (await post("/api/join", { code, nickname: "<b>Ana</b>", lang: "ar" })).json()) as any;
    expect(j.token).toMatch(/^[0-9a-f]{32}$/);
    expect(j.nickname).toBe("<b>Ana</b>"); // stored as text; client renders with textContent
    const j2 = (await (await post("/api/join", { code, nickname: "Ben" })).json()) as any;

    await host("/api/host/advance", { from: "lobby:0" });
    await host("/api/host/advance", { from: "scene:0" });
    const q = (await (await fetch(`${base}/api/state?token=${j.token}`)).json()) as any;
    expect(q.game.phase).toBe("question");
    expect(JSON.stringify(q)).not.toContain("feedback");

    expect((await post("/api/answer", { token: j.token, key: "A" })).status).toBe(200);
    const again = (await (await post("/api/answer", { token: j.token, key: "D" })).json()) as any;
    expect(again.key).toBe("A");
    await post("/api/answer", { token: j2.token, key: "B" });
    const hs = (await (await host("/api/host/state")).json()) as any;
    expect(hs.game.phase).toBe("reveal");
    expect(hs.reveal.best).toBe("A");
    expect(hs.reveal.options.find((o: any) => o.key === "B").knockout).toBe(true);

    const rep = (await (await fetch(`${base}/api/report/${j.token}`)).json()) as any;
    expect(rep.rounds.length).toBe(1);
    expect(rep.total).toBeGreaterThanOrEqual(1000);
    expect((await fetch(`${base}/api/report/${"0".repeat(32)}`)).status).toBe(404);
  });

  test("join is rate limited per IP (CF-Connecting-IP)", async () => {
    let limited = 0;
    for (let i = 0; i < 130; i++) {
      const r = await post("/api/join", { code: "0000", nickname: "x" }, { "CF-Connecting-IP": "203.0.113.9" });
      if (r.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
    const other = await post("/api/join", { code: "0000", nickname: "x" }, { "CF-Connecting-IP": "203.0.113.10" });
    expect(other.status).toBe(404);
  });
});
