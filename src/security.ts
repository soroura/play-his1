import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

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

/** Eight random digits for an added facilitator. Shown once; only the hash is stored. */
export function newPin(): string {
  return String(randomInt(10_000_000, 100_000_000));
}

export function hashPin(secret: string, pin: string): string {
  return sign(secret, "pin:" + pin);
}

/**
 * Cookie value: `<facilitator id>.<expiry>.<signature>`. The signature also covers `key` (a hash of that
 * facilitator's PIN), so changing a PIN or removing a person ends their existing logins.
 */
export function makeHostToken(secret: string, id: number, key: string, now = Date.now()): string {
  const exp = String(now + SESSION_MS);
  return `${id}.${exp}.${sign(secret, `host:${id}:${key}:${exp}`)}`;
}

/** Returns the facilitator id, or null. `keyOf` gives the current key for an id, or null if that id no longer exists. */
export function verifyHostToken(secret: string, token: string | undefined, keyOf: (id: number) => string | null, now = Date.now()): number | null {
  if (!token) return null;
  const m = /^(\d{1,12})\.(\d{1,16})\.([0-9a-f]{64})$/.exec(token);
  if (!m) return null;
  const id = Number(m[1]);
  if (Number(m[2]) < now) return null;
  const key = keyOf(id);
  if (key === null) return null;
  return safeEqual(m[3]!, sign(secret, `host:${id}:${key}:${m[2]}`)) ? id : null;
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
