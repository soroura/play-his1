import { existsSync, statSync } from "node:fs";
import { join, normalize, resolve, sep } from "node:path";
import { Engine, HttpError } from "./game.ts";
import { COOKIE_NAME, RateLimiter, SECURITY_HEADERS, hostCookie, makeHostToken, readCookie, safeEqual, verifyHostToken } from "./security.ts";

export interface ServerConfig {
  port: number;
  hostPin: string;
  secret: string;
  origin?: string; // PUBLIC_ORIGIN, no trailing slash
  publicDir: string;
  sha: string;
}

const PAGES: Record<string, string> = {
  "/": "index.html",
  "/play": "play.html",
  "/host": "host.html",
  "/host/help": "help.html",
};

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  ico: "image/x-icon",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
};

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS, ...extra },
  });
}

export function createServer(engine: Engine, cfg: ServerConfig) {
  const publicRoot = resolve(cfg.publicDir);
  const secureCookie = (cfg.origin ?? "").startsWith("https://");
  const joinLimit = new RateLimiter(120, 60_000);
  const answerLimit = new RateLimiter(400, 60_000);
  const loginLimit = new RateLimiter(10, 60_000);

  function clientIp(req: Request, server: { requestIP(r: Request): { address: string } | null }): string {
    return req.headers.get("cf-connecting-ip") ?? server.requestIP(req)?.address ?? "unknown";
  }

  async function body(req: Request): Promise<Record<string, unknown>> {
    const text = await req.text();
    if (text.length > 4096) throw new HttpError(413, "Request too large");
    if (!text.trim()) return {};
    try {
      const v = JSON.parse(text);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* fall through */
    }
    throw new HttpError(400, "Invalid JSON");
  }

  function isHost(req: Request): boolean {
    return verifyHostToken(cfg.secret, readCookie(req.headers.get("cookie"), COOKIE_NAME));
  }

  function requestOrigin(req: Request): string {
    if (cfg.origin) return cfg.origin;
    const u = new URL(req.url);
    const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
    return `${proto}://${req.headers.get("host") ?? u.host}`;
  }

  function serveStatic(pathname: string): Response {
    let rel: string;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (rel.includes("\0") || rel.includes("\\")) return new Response("Bad request", { status: 400 });
    const file = PAGES[rel] ?? (rel.startsWith("/report/") ? "report.html" : rel.replace(/^\/+/, ""));
    const full = resolve(join(publicRoot, normalize(file)));
    if (full !== publicRoot && !full.startsWith(publicRoot + sep)) return new Response("Not found", { status: 404 });
    if (!existsSync(full) || !statSync(full).isFile()) return new Response("Not found", { status: 404 });
    const ext = full.slice(full.lastIndexOf(".") + 1).toLowerCase();
    const type = TYPES[ext];
    if (!type) return new Response("Not found", { status: 404 });
    const cache = ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "webp" ? "public, max-age=86400" : "no-cache";
    return new Response(Bun.file(full), { headers: { "Content-Type": type, "Cache-Control": cache, ...SECURITY_HEADERS } });
  }

  async function api(req: Request, url: URL, ip: string): Promise<Response> {
    const path = url.pathname;
    const isPost = req.method === "POST";
    if (isPost && cfg.origin) {
      if (req.headers.get("origin") !== cfg.origin) throw new HttpError(403, "Bad origin");
    }
    if (path === "/api/health" && req.method === "GET") return json({ ok: true, sha: cfg.sha, rounds: engine.rounds.length });

    // ----- host -----
    if (path === "/api/host/login" && isPost) {
      if (!loginLimit.allow(ip)) throw new HttpError(429, "Too many attempts. Wait a minute.");
      const b = await body(req);
      if (typeof b.pin !== "string" || !safeEqual(b.pin, cfg.hostPin)) throw new HttpError(401, "Wrong PIN");
      return json({ ok: true }, 200, { "Set-Cookie": hostCookie(makeHostToken(cfg.secret), secureCookie) });
    }
    if (path === "/api/host/logout" && isPost) return json({ ok: true }, 200, { "Set-Cookie": hostCookie("", secureCookie, true) });
    if (path.startsWith("/api/host/")) {
      if (!isHost(req)) throw new HttpError(401, "Host login required");
      if (path === "/api/host/state" && req.method === "GET") {
        const v = url.searchParams.get("v");
        return json(engine.hostState(requestOrigin(req), v !== null && /^\d+$/.test(v) ? Number(v) : undefined));
      }
      if (isPost) {
        const b = await body(req);
        const from = typeof b.from === "string" ? b.from : undefined;
        switch (path) {
          case "/api/host/game":
            engine.createGame();
            break;
          case "/api/host/advance":
            engine.advance(from);
            break;
          case "/api/host/reveal":
            engine.reveal();
            break;
          case "/api/host/extend":
            engine.extend();
            break;
          default:
            throw new HttpError(404, "Not found");
        }
        return json(engine.hostState(requestOrigin(req)));
      }
      throw new HttpError(405, "Method not allowed");
    }

    // ----- player -----
    if (path === "/api/join" && isPost) {
      if (!joinLimit.allow(ip)) throw new HttpError(429, "Too many attempts. Wait a minute.");
      const b = await body(req);
      return json({ ok: true, ...engine.join(b) });
    }
    if (path === "/api/state" && req.method === "GET") {
      const v = url.searchParams.get("v");
      return json(engine.playerState(url.searchParams.get("token"), v !== null && /^\d+$/.test(v) ? Number(v) : undefined));
    }
    if (path === "/api/answer" && isPost) {
      if (!answerLimit.allow(ip)) throw new HttpError(429, "Too many answers. Wait a moment.");
      const b = await body(req);
      return json({ ok: true, ...engine.answer(b.token, b.key) });
    }
    if (path.startsWith("/api/report/") && req.method === "GET") {
      return json(engine.report(decodeURIComponent(path.slice("/api/report/".length))));
    }
    throw new HttpError(404, "Not found");
  }

  const server = Bun.serve({
    port: cfg.port,
    hostname: process.env.HOST_BIND ?? "0.0.0.0",
    async fetch(req, srv) {
      const url = new URL(req.url);
      try {
        if (url.pathname.startsWith("/api/")) return await api(req, url, clientIp(req, srv));
        if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
        return serveStatic(url.pathname);
      } catch (e) {
        if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
        console.error("[play] unhandled", e);
        return json({ ok: false, error: "Server error" }, 500);
      }
    },
  });

  const timer = setInterval(() => {
    try {
      engine.tick();
    } catch (e) {
      console.error("[play] tick failed", e);
    }
  }, 1000);

  return {
    server,
    port: server.port as number,
    stop() {
      clearInterval(timer);
      void server.stop(true);
    },
  };
}
