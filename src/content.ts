import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type L = { en: string; ar?: string };
export type LS = string | L;
export type Tone = "normal" | "warn" | "crit";
export type Style = "feed" | "chat" | "photo" | "document";

export interface SceneLine {
  t?: string;
  who?: string;
  tone: Tone;
  text: L;
}
export interface Option {
  key: string;
  text: L;
  score: number;
  knockout: boolean;
  feedback: L;
}
export interface WhyPoint {
  tag: string;
  text: L;
}
export interface RealCase {
  title: LS;
  text: LS;
  source: LS;
  status: "verified" | "partly";
}
export interface Round {
  id: number;
  clock: string;
  place: L;
  title: L;
  scene: { style: Style; image?: string; lines: SceneLine[] };
  question: L;
  timeLimit: number;
  options: Option[];
  why: WhyPoint[];
  standards: string[];
  realCase: RealCase;
  set: RoundSet;
  minutes: number;
  keyMessages: L[];
  discussion: L[];
}
export type RoundSet = "core" | "extra";
export const DEFAULT_MINUTES = 8;
export interface Content {
  meta: { title: L; hospital: string };
  rounds: Round[];
}

const STYLES = ["feed", "chat", "photo", "document"];
const TONES = ["normal", "warn", "crit"];
const TAGS = ["G", "S", "E", "X", "I"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function checkL(v: unknown, path: string, errors: string[], required = true): L | undefined {
  if (v === undefined && !required) return undefined;
  if (!isObj(v) || !isStr(v.en)) {
    errors.push(`${path}: must be an object with a non-empty "en" string`);
    return undefined;
  }
  if (v.ar !== undefined && typeof v.ar !== "string") errors.push(`${path}.ar: must be a string when present`);
  const out: L = { en: v.en };
  if (typeof v.ar === "string" && v.ar.trim()) out.ar = v.ar;
  return out;
}

function checkLS(v: unknown, path: string, errors: string[]): LS | undefined {
  if (isStr(v)) return v;
  return checkL(v, path, errors);
}

export interface Validation {
  content?: Content;
  errors: string[];
  warnings: string[];
}

export function validateContent(raw: unknown, publicDir?: string): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(raw)) return { errors: ["content: top level must be an object"], warnings };
  const meta = raw.meta;
  let metaOut: Content["meta"] | undefined;
  if (!isObj(meta)) errors.push("meta: missing");
  else {
    const title = checkL(meta.title, "meta.title", errors);
    if (!isStr(meta.hospital)) errors.push("meta.hospital: must be a non-empty string");
    if (title && isStr(meta.hospital)) metaOut = { title, hospital: meta.hospital };
  }
  const rounds: Round[] = [];
  if (!Array.isArray(raw.rounds) || raw.rounds.length === 0) errors.push("rounds: must be a non-empty array");
  else {
    const seen = new Set<number>();
    raw.rounds.forEach((r, i) => {
      const p = `rounds[${i}]`;
      if (!isObj(r)) return void errors.push(`${p}: must be an object`);
      const before = errors.length;
      if (!Number.isInteger(r.id)) errors.push(`${p}.id: must be an integer`);
      else if (seen.has(r.id as number)) errors.push(`${p}.id: duplicate id ${String(r.id)}`);
      else seen.add(r.id as number);
      if (!isStr(r.clock)) errors.push(`${p}.clock: must be a non-empty string`);
      const place = checkL(r.place, `${p}.place`, errors);
      const title = checkL(r.title, `${p}.title`, errors);
      const question = checkL(r.question, `${p}.question`, errors);
      // scene
      let scene: Round["scene"] | undefined;
      if (!isObj(r.scene)) errors.push(`${p}.scene: missing`);
      else {
        const s = r.scene;
        if (typeof s.style !== "string" || !STYLES.includes(s.style)) errors.push(`${p}.scene.style: must be one of ${STYLES.join(", ")}`);
        let image: string | undefined;
        if (s.image !== undefined) {
          if (!isStr(s.image) || s.image.includes("..") || s.image.startsWith("/") || s.image.includes("\\"))
            errors.push(`${p}.scene.image: must be a relative path like "img/dark-ward.jpg"`);
          else {
            image = s.image;
            if (publicDir && !existsSync(join(publicDir, image))) warnings.push(`${p}.scene.image: file public/${image} not found`);
          }
        }
        if (s.style === "photo" && !image) errors.push(`${p}.scene.image: required for style "photo"`);
        const lines: SceneLine[] = [];
        if (!Array.isArray(s.lines)) errors.push(`${p}.scene.lines: must be an array`);
        else {
          s.lines.forEach((ln, j) => {
            const lp = `${p}.scene.lines[${j}]`;
            if (!isObj(ln)) return void errors.push(`${lp}: must be an object`);
            const text = checkL(ln.text, `${lp}.text`, errors);
            const tone = ln.tone === undefined ? "normal" : ln.tone;
            if (typeof tone !== "string" || !TONES.includes(tone)) errors.push(`${lp}.tone: must be one of ${TONES.join(", ")}`);
            if (ln.who !== undefined && typeof ln.who !== "string") errors.push(`${lp}.who: must be a string`);
            if (ln.t !== undefined && typeof ln.t !== "string") errors.push(`${lp}.t: must be a string`);
            if (text) {
              const line: SceneLine = { tone: tone as Tone, text };
              if (typeof ln.t === "string") line.t = ln.t;
              if (typeof ln.who === "string" && ln.who) line.who = ln.who;
              lines.push(line);
            }
          });
          if (s.style === "photo" && s.lines.length === 0) warnings.push(`${p}.scene.lines: photo scene has no callouts`);
        }
        if (typeof s.style === "string" && STYLES.includes(s.style)) {
          scene = { style: s.style as Style, lines };
          if (image) scene.image = image;
        }
      }
      // timeLimit
      if (!Number.isInteger(r.timeLimit) || (r.timeLimit as number) < 5 || (r.timeLimit as number) > 600)
        errors.push(`${p}.timeLimit: must be an integer between 5 and 600 (seconds)`);
      // options
      const options: Option[] = [];
      if (!Array.isArray(r.options) || r.options.length !== 4) errors.push(`${p}.options: must contain exactly 4 options`);
      else {
        const keys = new Set<string>();
        let best = 0;
        r.options.forEach((o, j) => {
          const op = `${p}.options[${j}]`;
          if (!isObj(o)) return void errors.push(`${op}: must be an object`);
          if (!isStr(o.key)) errors.push(`${op}.key: must be a non-empty string`);
          else if (keys.has(o.key)) errors.push(`${op}.key: duplicate key "${o.key}"`);
          else keys.add(o.key);
          const text = checkL(o.text, `${op}.text`, errors);
          const feedback = checkL(o.feedback, `${op}.feedback`, errors);
          if (typeof o.score !== "number" || !Number.isFinite(o.score) || o.score < 0 || o.score > 1000)
            errors.push(`${op}.score: must be a number between 0 and 1000`);
          if (typeof o.knockout !== "boolean") errors.push(`${op}.knockout: must be true or false`);
          if (o.score === 1000) best++;
          if (o.knockout === true && typeof o.score === "number" && o.score > 0)
            warnings.push(`${op}: knockout option has score ${o.score}; it will score 0`);
          if (isStr(o.key) && text && feedback && typeof o.score === "number" && typeof o.knockout === "boolean")
            options.push({ key: o.key, text, score: o.score, knockout: o.knockout, feedback });
        });
        if (best !== 1) errors.push(`${p}.options: exactly one option must have score 1000 (found ${best})`);
      }
      // why
      const why: WhyPoint[] = [];
      if (!Array.isArray(r.why)) errors.push(`${p}.why: must be an array`);
      else
        r.why.forEach((w, j) => {
          const wp = `${p}.why[${j}]`;
          if (!isObj(w)) return void errors.push(`${wp}: must be an object`);
          if (typeof w.tag !== "string" || !TAGS.includes(w.tag)) errors.push(`${wp}.tag: must be one of ${TAGS.join(", ")}`);
          const text = checkL(w.text, `${wp}.text`, errors);
          if (text && typeof w.tag === "string") why.push({ tag: w.tag, text });
        });
      // standards
      let standards: string[] = [];
      if (!Array.isArray(r.standards) || !r.standards.every((x) => isStr(x))) errors.push(`${p}.standards: must be an array of strings`);
      else standards = r.standards as string[];
      // real case
      let realCase: RealCase | undefined;
      if (!isObj(r.realCase)) errors.push(`${p}.realCase: missing`);
      else {
        const rc = r.realCase;
        const title = checkLS(rc.title, `${p}.realCase.title`, errors);
        const text = checkLS(rc.text, `${p}.realCase.text`, errors);
        const source = checkLS(rc.source, `${p}.realCase.source`, errors);
        if (rc.status !== "verified" && rc.status !== "partly") errors.push(`${p}.realCase.status: must be "verified" or "partly"`);
        if (title && text && source && (rc.status === "verified" || rc.status === "partly"))
          realCase = { title, text, source, status: rc.status };
      }
      // optional facilitator fields
      let set: RoundSet = "core";
      if (r.set !== undefined) {
        if (r.set !== "core" && r.set !== "extra") errors.push(`${p}.set: must be "core" or "extra"`);
        else set = r.set;
      }
      let minutes = DEFAULT_MINUTES;
      if (r.minutes !== undefined) {
        if (typeof r.minutes !== "number" || !Number.isFinite(r.minutes) || r.minutes < 3 || r.minutes > 20) errors.push(`${p}.minutes: must be a number between 3 and 20`);
        else minutes = r.minutes;
      }
      const checkList = (v: unknown, name: string, max: number): L[] => {
        const out: L[] = [];
        if (v === undefined) return out;
        if (!Array.isArray(v)) errors.push(`${p}.${name}: must be an array`);
        else {
          if (v.length > max) errors.push(`${p}.${name}: at most ${max} items (found ${v.length})`);
          v.forEach((x, j) => {
            const l = checkL(x, `${p}.${name}[${j}]`, errors);
            if (l) out.push(l);
          });
        }
        return out;
      };
      const keyMessages = checkList(r.keyMessages, "keyMessages", 4);
      const discussion = checkList(r.discussion, "discussion", 3);
      if (errors.length === before && place && title && question && scene && realCase && metaOut !== undefined) {
        rounds.push({
          id: r.id as number,
          clock: r.clock as string,
          place,
          title,
          scene,
          question,
          timeLimit: r.timeLimit as number,
          options,
          why,
          standards,
          realCase,
          set,
          minutes,
          keyMessages,
          discussion,
        });
      }
    });
  }
  if (errors.length || !metaOut) return { errors: errors.length ? errors : ["content: invalid"], warnings };
  return { content: { meta: metaOut, rounds }, errors, warnings };
}

export function resolveContentFile(root: string, envFile?: string): { path: string; fallback: boolean } {
  const wanted = envFile && envFile.trim() ? envFile : join(root, "content", "rounds.json");
  if (existsSync(wanted)) return { path: wanted, fallback: false };
  const ex = join(root, "content", "rounds.example.json");
  if (existsSync(ex)) return { path: ex, fallback: true };
  throw new Error(`Content file not found: ${wanted} (and no content/rounds.example.json fallback)`);
}

export function loadContent(file: string, publicDir?: string): { content: Content; warnings: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`Content file ${file} is not valid JSON: ${(e as Error).message}`);
  }
  const v = validateContent(raw, publicDir);
  if (!v.content) throw new Error(`Content file ${file} is invalid:\n  - ${v.errors.join("\n  - ")}`);
  return { content: v.content, warnings: v.warnings };
}
