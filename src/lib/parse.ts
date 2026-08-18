import type { Env } from "../env.js";

export interface ParsedEvent {
  title?: string;
  start?: string; // ISO with offset, e.g. "2026-09-14T20:00:00-04:00"
  end?: string;
  location?: string;
  timezone?: string;
  confidence: number; // 0..1
}

export interface ParseResult extends ParsedEvent {
  outcome: "caption" | "vision" | "failed";
}

const SYSTEM_PROMPT = `You extract a single event from an Instagram post.
Return STRICT JSON matching this TypeScript type, and nothing else:
{ "title"?: string, "start"?: string, "end"?: string, "location"?: string, "timezone"?: string, "confidence": number }

Rules:
- "start" and "end" must be ISO 8601 with timezone offset if a specific date+time is stated.
  If only a date is stated, still return an ISO datetime using a reasonable default local time (e.g. 20:00 for shows).
- "timezone" is an IANA name if determinable (e.g. "America/New_York"), else omitted.
- "confidence" is your own 0..1 estimate that the extracted event is correct and complete.
- If the post is not an event (no date signal at all), return {"confidence": 0}.
- Do not invent details. Prefer omission over fabrication.
- Output JSON only, no code fences.`;

export async function parseCascade(
  env: Env,
  input: { caption?: string; imageBytes?: ArrayBuffer; imageMime?: string },
): Promise<ParseResult> {
  const threshold = Number(env.PARSE_CONFIDENCE_THRESHOLD) || 0.6;

  if (input.caption && input.caption.trim().length > 0) {
    const p = await geminiText(env, input.caption);
    if (p && p.confidence >= threshold && p.start) {
      return { ...p, outcome: "caption" };
    }
  }

  if (input.imageBytes) {
    const v = await geminiVision(env, input.imageBytes, input.imageMime ?? "image/jpeg", input.caption);
    if (v && v.confidence >= threshold && v.start) {
      return { ...v, outcome: "vision" };
    }
    if (v) return { ...v, outcome: "failed" };
  }

  return { confidence: 0, outcome: "failed" };
}

async function geminiText(env: Env, caption: string): Promise<ParsedEvent | null> {
  const body = {
    contents: [{ role: "user", parts: [{ text: `${SYSTEM_PROMPT}\n\nCAPTION:\n${caption}` }] }],
    generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
  };
  return callGemini(env, "gemini-1.5-flash-latest", body);
}

async function geminiVision(
  env: Env,
  bytes: ArrayBuffer,
  mime: string,
  caption?: string,
): Promise<ParsedEvent | null> {
  const b64 = arrayBufferToBase64(bytes);
  const parts: Array<Record<string, unknown>> = [
    { text: `${SYSTEM_PROMPT}\n\nCAPTION (may be empty):\n${caption ?? ""}` },
    { inline_data: { mime_type: mime, data: b64 } },
  ];
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
  };
  return callGemini(env, "gemini-1.5-flash-latest", body);
}

async function callGemini(env: Env, model: string, body: unknown): Promise<ParsedEvent | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = j.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as ParsedEvent;
    if (typeof parsed.confidence !== "number") parsed.confidence = 0;
    return parsed;
  } catch {
    return null;
  }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
