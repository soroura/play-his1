import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "play_host";
const SESSION_MS = 12 * 3600 * 1000;

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function makeHostToken(secret: string, now = Date.now()): string {
  const exp = String(now + SESSION_MS);
  return `${exp}.${sign(secret, "host:" + exp)}`;
}

export function verifyHostToken(secret: string, token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const i = token.indexOf(".");
  if (i < 1) return false;
  const exp = token.slice(0, i);
  const sig = token.slice(i + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < now) return false;
  return safeEqual(sig, sign(secret, "host:" + exp));
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

export function hostCookie(token: string, secure: boolean, clear = false): string {
  const attrs = [`${COOKIE_NAME}=${clear ? "" : token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${clear ? 0 : SESSION_MS / 1000}`];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

/** Fixed-window rate limiter keyed by string. */
export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(
    private max: number,
    private windowMs: number,
    private clock: () => number = () => Date.now(),
  ) {}
  allow(key: string): boolean {
    const now = this.clock();
    const h = this.hits.get(key);
    if (!h || now >= h.reset) {
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      if (this.hits.size > 5000) this.sweep(now);
      return true;
    }
    h.n++;
    return h.n <= this.max;
  }
  private sweep(now: number) {
    for (const [k, v] of this.hits) if (now >= v.reset) this.hits.delete(k);
  }
}

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
