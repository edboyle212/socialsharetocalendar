import { describe, it, expect } from "vitest";
import {
  buildPayload,
  googleCalendarUrl,
  buildIcs,
  signToken,
  verifyToken,
} from "../src/lib/calendar.js";

describe("calendar", () => {
  const event = {
    title: "Band X @ Venue Y",
    start: "2026-09-14T20:00:00-04:00",
    end: "2026-09-14T23:00:00-04:00",
    location: "Venue Y, Brooklyn",
    confidence: 0.9,
  };
  const ctx = { permalink: "https://instagram.com/p/abc", username: "somepromoter" };

  it("builds payload with notes containing permalink and handle", () => {
    const p = buildPayload(event, ctx)!;
    expect(p.description).toContain("https://instagram.com/p/abc");
    expect(p.description).toContain("@somepromoter");
    expect(p.title).toBe("Band X @ Venue Y");
  });

  it("defaults end to +2h when only start given", () => {
    const p = buildPayload({ ...event, end: undefined }, ctx)!;
    expect(new Date(p.end).getTime() - new Date(p.start).getTime()).toBe(2 * 60 * 60 * 1000);
  });

  it("google calendar url has expected params", () => {
    const p = buildPayload(event, ctx)!;
    const u = new URL(googleCalendarUrl(p));
    expect(u.searchParams.get("action")).toBe("TEMPLATE");
    expect(u.searchParams.get("text")).toBe(p.title);
    expect(u.searchParams.get("dates")).toMatch(/^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/);
  });

  it("ics has required VEVENT lines and escapes commas", () => {
    const p = buildPayload(event, ctx)!;
    const ics = buildIcs(p, "uid-1");
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:uid-1");
    expect(ics).toContain("LOCATION:Venue Y\\, Brooklyn");
  });

  it("signed token round-trips and rejects tampering", async () => {
    const secret = "s3cret";
    const tok = await signToken(secret, { cid: 1, kind: "gcal", gcal: "https://example.com" });
    const back = await verifyToken<{ gcal: string }>(secret, tok);
    expect(back?.gcal).toBe("https://example.com");
    const tampered = tok.slice(0, -1) + (tok.endsWith("a") ? "b" : "a");
    expect(await verifyToken(secret, tampered)).toBeNull();
    expect(await verifyToken("wrong", tok)).toBeNull();
  });
});
