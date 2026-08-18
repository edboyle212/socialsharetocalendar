import type { Env } from "../../env.js";

export interface ParsedEvent {
  title?: string;
  start?: string;
  end?: string;
  location?: string;
  timezone?: string;
  confidence: number;
}

export interface ParserResult extends ParsedEvent {
  outcome: "caption" | "vision" | "failed";
  model: string;
}

export interface ParserInput {
  caption?: string;
  imageBytes?: ArrayBuffer;
  imageMime?: string;
}

// A parser is a full text→vision cascade for a single provider. It
// returns the best result it can and tags itself in `model`. If it
// throws or returns { outcome: "failed", confidence: 0 }, the
// orchestrator can try the next parser.
export interface Parser {
  readonly id: string;
  parse(env: Env, input: ParserInput): Promise<ParserResult>;
  // Apply a natural-language correction to a previously-extracted
  // event. Returns the revised event or null on failure.
  refine?(env: Env, current: ParsedEvent, correction: string): Promise<ParsedEvent | null>;
}

export const REFINE_PROMPT = `You are updating a previously-extracted event based on the user's correction.
CURRENT_EVENT is what you extracted before; CORRECTION is a short message from the user.

Return STRICT JSON matching the same schema as the initial extract:
{ "title"?: string, "start"?: string, "end"?: string, "location"?: string, "timezone"?: string, "confidence": number }

Rules:
- Keep every CURRENT_EVENT field that the CORRECTION does not contradict.
- Interpret the correction liberally: "TZ Europe/Berlin" sets timezone;
  "at 9pm" adjusts the start time (keep the date); "on Sep 20" adjusts
  the date (keep the time); "at Foo Bar" sets location; free-form
  natural language also fine.
- ISO fields stay naive local (no "Z", no offset).
- "confidence" is your revised estimate for the merged result.
- Output JSON only, no code fences.`;

export const SYSTEM_PROMPT = `You extract a single event from an Instagram post.
Return STRICT JSON matching this TypeScript type, and nothing else:
{ "title"?: string, "start"?: string, "end"?: string, "location"?: string, "timezone"?: string, "confidence": number }

Rules:
- "start" and "end" are local wall-clock ISO 8601 without any offset,
  e.g. "2026-09-14T20:00:00". Do NOT append "Z" or a "+HH:MM" offset.
- If only a date is stated, still return an ISO datetime using a
  reasonable default local time (e.g. 20:00 for shows).
- "timezone" MUST be an IANA name (e.g. "America/New_York",
  "Europe/Berlin") whenever ANY location signal is present — a city,
  neighborhood, venue name, country, area code, or currency symbol.
  Pick the most specific zone the signal justifies. Only omit the
  field when NO location signal exists at all.
- "confidence" is your own 0..1 estimate that the extracted event is
  correct AND that you got the timezone right if you set one.
- If the post is not an event (no date signal at all), return {"confidence": 0}.
- Do not invent details. Prefer omission over fabrication.
- Output JSON only, no code fences.`;

// Defensive JSON parser: strips code fences, then falls back to the
// first {...} block. Providers vary in how strictly they honor the
// "no code fences" rule.
export function extractJson(text: string): ParsedEvent | null {
  const stripped = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const attempts = [stripped];
  const brace = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (brace >= 0 && end > brace) attempts.push(stripped.slice(brace, end + 1));
  for (const s of attempts) {
    try {
      const p = JSON.parse(s) as ParsedEvent;
      if (typeof p.confidence !== "number") p.confidence = 0;
      return p;
    } catch { /* try next */ }
  }
  return null;
}

export function threshold(env: Env): number {
  return Number(env.PARSE_CONFIDENCE_THRESHOLD) || 0.6;
}
