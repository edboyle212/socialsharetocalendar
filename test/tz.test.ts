import { describe, it, expect } from "vitest";
import {
  isNaiveIso,
  isValidIana,
  tzOffsetMinutes,
  naiveToUtcIso,
  normalizeTime,
} from "../src/lib/tz.js";

describe("tz helpers", () => {
  it("detects naive vs aware ISO strings", () => {
    expect(isNaiveIso("2026-09-14T20:00:00")).toBe(true);
    expect(isNaiveIso("2026-09-14T20:00")).toBe(true);
    expect(isNaiveIso("2026-09-14T20:00:00Z")).toBe(false);
    expect(isNaiveIso("2026-09-14T20:00:00-04:00")).toBe(false);
    expect(isNaiveIso("2026-09-14T20:00:00+0530")).toBe(false);
  });

  it("validates IANA names", () => {
    expect(isValidIana("America/New_York")).toBe(true);
    expect(isValidIana("Europe/Berlin")).toBe(true);
    expect(isValidIana("Not/A_Zone")).toBe(false);
    expect(isValidIana("EST")).toBe(true); // legacy alias still accepted
  });

  it("computes offset minutes for a summer date in NY (EDT = -240)", () => {
    const off = tzOffsetMinutes("America/New_York", new Date("2026-07-15T12:00:00Z"));
    expect(off).toBe(-240);
  });

  it("computes offset minutes for a winter date in NY (EST = -300)", () => {
    const off = tzOffsetMinutes("America/New_York", new Date("2026-01-15T12:00:00Z"));
    expect(off).toBe(-300);
  });

  it("naiveToUtcIso converts NY summer 20:00 → 00:00 UTC next day", () => {
    const iso = naiveToUtcIso("2026-09-14T20:00:00", "America/New_York");
    // NY is UTC-4 in mid-September → 20:00 local = 00:00 UTC next day
    expect(iso).toBe("2026-09-15T00:00:00.000Z");
  });

  it("naiveToUtcIso handles Berlin winter", () => {
    const iso = naiveToUtcIso("2026-01-10T21:00:00", "Europe/Berlin");
    // CET is UTC+1 → 21:00 local = 20:00 UTC
    expect(iso).toBe("2026-01-10T20:00:00.000Z");
  });

  it("normalizeTime respects an already-aware ISO", () => {
    const n = normalizeTime("2026-09-14T20:00:00-04:00", "America/New_York");
    expect(n.floating).toBe(false);
    expect(n.iso).toBe("2026-09-14T20:00:00-04:00");
    expect(n.assumedTz).toBeUndefined();
  });

  it("normalizeTime resolves naive + valid TZ", () => {
    const n = normalizeTime("2026-09-14T20:00:00", "America/New_York");
    expect(n.floating).toBe(false);
    expect(n.iso).toBe("2026-09-15T00:00:00.000Z");
    expect(n.assumedTz).toBe("America/New_York");
  });

  it("normalizeTime keeps naive floating when TZ is missing or bad", () => {
    const noTz = normalizeTime("2026-09-14T20:00:00", undefined);
    expect(noTz.floating).toBe(true);
    expect(noTz.iso).toBe("2026-09-14T20:00:00");

    const badTz = normalizeTime("2026-09-14T20:00:00", "Not/A_Zone");
    expect(badTz.floating).toBe(true);
  });
});
