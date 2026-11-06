import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadContent, resolveContentFile, validateContent } from "../src/content.ts";
import { EXAMPLE } from "./helpers.ts";

const raw = () => JSON.parse(readFileSync(EXAMPLE, "utf8"));

describe("content validation", () => {
  test("example content is valid", () => {
    const { content } = loadContent(EXAMPLE);
    expect(content.rounds.length).toBe(2);
    expect(content.rounds[0]!.scene.style).toBe("feed");
    expect(content.rounds[1]!.scene.style).toBe("chat");
  });

  test("rejects a round with 3 options", () => {
    const c = raw();
    c.rounds[0].options.pop();
    const v = validateContent(c);
    expect(v.content).toBeUndefined();
    expect(v.errors.join("\n")).toContain("exactly 4 options");
  });

  test("rejects zero or two best options", () => {
    const c = raw();
    c.rounds[0].options[1].score = 1000;
    expect(validateContent(c).errors.join("\n")).toContain("exactly one option must have score 1000 (found 2)");
    const d = raw();
    d.rounds[0].options[0].score = 400;
    expect(validateContent(d).errors.join("\n")).toContain("(found 0)");
  });

  test("ar is optional", () => {
    const c = raw();
    delete c.rounds[0].question.ar;
    delete c.rounds[0].options[0].feedback.ar;
    expect(validateContent(c).content).toBeDefined();
  });

  test("reports bad style, tag and missing en with paths", () => {
    const c = raw();
    c.rounds[0].scene.style = "hologram";
    c.rounds[0].why[0].tag = "Z";
    delete c.rounds[1].title.en;
    const e = validateContent(c).errors.join("\n");
    expect(e).toContain("rounds[0].scene.style");
    expect(e).toContain("rounds[0].why[0].tag");
    expect(e).toContain("rounds[1].title");
  });

  test("photo scene needs an image; image path is confined", () => {
    const c = raw();
    c.rounds[0].scene.style = "photo";
    expect(validateContent(c).errors.join("\n")).toContain("required for style");
    c.rounds[0].scene.image = "../secret.jpg";
    expect(validateContent(c).errors.join("\n")).toContain("relative path");
  });

  test("duplicate round ids and bad JSON", () => {
    const c = raw();
    c.rounds[1].id = 1;
    expect(validateContent(c).errors.join("\n")).toContain("duplicate id");
    expect(validateContent("nope").errors.length).toBe(1);
  });

  test("falls back to the example file when rounds.json is missing", () => {
    const r = resolveContentFile(import.meta.dir + "/..", "/nonexistent/rounds.json");
    expect(r.fallback).toBe(true);
    expect(r.path.endsWith("rounds.example.json")).toBe(true);
  });
});
