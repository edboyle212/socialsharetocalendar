import { describe, it, expect } from "vitest";
import { formatDigest, TRIGGERS, type Digest } from "../src/lib/digest.js";

function baseDigest(overrides: Partial<Digest> = {}): Digest {
  const now = Date.now();
  return {
    ts: now,
    window: { start: now - 7 * 86400000, end: now },
    conversions7d: 0,
    successful7d: 0,
    failed7d: 0,
    dlq7d: 0,
    activeUsers30d: 0,
    quotaHitUsers30d: 0,
    modelSplit30d: [],
    weeklyHistory: [],
    triggers: {
      volumeMet: false,
      volumeStreak: 0,
      quotaPressureMet: false,
      quotaPressureRatio: 0,
      anyMet: false,
    },
    ...overrides,
  };
}

describe("formatDigest", () => {
  it("summarizes a quiet week", () => {
    const text = formatDigest(baseDigest());
    expect(text).toContain("7d: 0 shares");
    expect(text).toContain("No trigger met");
  });

  it("flags the phase-2 volume trigger when streak is met", () => {
    const d = baseDigest({
      conversions7d: 60,
      successful7d: 55,
      failed7d: 5,
      triggers: {
        volumeMet: true,
        volumeStreak: TRIGGERS.sustainedWeeksNeeded,
        quotaPressureMet: false,
        quotaPressureRatio: 0.05,
        anyMet: true,
      },
    });
    const text = formatDigest(d);
    expect(text).toContain("Phase-2 trigger met");
    expect(text).toContain(`streak ${TRIGGERS.sustainedWeeksNeeded}`);
  });

  it("flags the quota-pressure trigger", () => {
    const d = baseDigest({
      activeUsers30d: 100,
      quotaHitUsers30d: 25,
      triggers: {
        volumeMet: false,
        volumeStreak: 1,
        quotaPressureMet: true,
        quotaPressureRatio: 0.25,
        anyMet: true,
      },
    });
    const text = formatDigest(d);
    expect(text).toContain("Phase-2 trigger met");
    expect(text).toContain("30d: 100 MAU, 25 hit quota");
  });

  it("renders a model split line", () => {
    const d = baseDigest({
      modelSplit30d: [
        { model: "gemini/gemini-1.5-flash-latest", n: 40, avgConfidence: 0.82 },
        { model: "workers-ai/@cf/meta/llama-3.2-11b-vision-instruct", n: 8, avgConfidence: 0.61 },
      ],
    });
    const text = formatDigest(d);
    expect(text).toContain("gemini/gemini-1.5-flash-latest 40(conf 0.82)");
    expect(text).toContain("workers-ai");
  });
});
