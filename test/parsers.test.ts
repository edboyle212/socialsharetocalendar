import { describe, it, expect } from "vitest";
import { extractJson } from "../src/lib/parsers/types.js";

describe("extractJson (shared defensive parser)", () => {
  it("parses a bare JSON object", () => {
    const p = extractJson('{"title":"X","start":"2026-09-14T20:00:00","confidence":0.9}');
    expect(p?.title).toBe("X");
    expect(p?.confidence).toBe(0.9);
  });

  it("strips a ```json fenced block", () => {
    const p = extractJson('```json\n{"confidence":0.5}\n```');
    expect(p?.confidence).toBe(0.5);
  });

  it("falls back to the first {...} block when the model rambles", () => {
    const p = extractJson('Sure! Here you go: {"confidence":0.3,"title":"Y"} — hope that helps.');
    expect(p?.title).toBe("Y");
  });

  it("defaults missing confidence to 0", () => {
    const p = extractJson('{"title":"Z"}');
    expect(p?.confidence).toBe(0);
  });

  it("returns null on truly unparseable output", () => {
    expect(extractJson("nope not json at all")).toBeNull();
  });
});
