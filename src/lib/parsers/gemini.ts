import type { Env } from "../../env.js";
import {
  type Parser,
  type ParserInput,
  type ParserResult,
  type ParsedEvent,
  SYSTEM_PROMPT,
  REFINE_PROMPT,
  extractJson,
  threshold,
} from "./types.js";

const MODEL_ID = "gemini-1.5-flash-latest";

export const GeminiParser: Parser = {
  id: `gemini/${MODEL_ID}`,

  async parse(env: Env, input: ParserInput): Promise<ParserResult> {
    if (!env.GEMINI_API_KEY) {
      throw new Error("gemini: GEMINI_API_KEY not set");
    }
    const th = threshold(env);

    if (input.caption?.trim()) {
      const p = await textPass(env, input.caption);
      if (p && p.confidence >= th && p.start) {
        return { ...p, outcome: "caption", model: this.id };
      }
    }
    if (input.imageBytes) {
      const v = await visionPass(env, input.imageBytes, input.imageMime ?? "image/jpeg", input.caption);
      if (v && v.confidence >= th && v.start) {
        return { ...v, outcome: "vision", model: this.id };
      }
      if (v) return { ...v, outcome: "failed", model: this.id };
    }
    return { confidence: 0, outcome: "failed", model: this.id };
  },

  async refine(env: Env, current: ParsedEvent, correction: string): Promise<ParsedEvent | null> {
    if (!env.GEMINI_API_KEY) throw new Error("gemini: GEMINI_API_KEY not set");
    const text = `${REFINE_PROMPT}\n\nCURRENT_EVENT:\n${JSON.stringify(current)}\n\nCORRECTION:\n${correction}`;
    const body = {
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
    };
    return callGemini(env, body);
  },
};

async function textPass(env: Env, caption: string): Promise<ParsedEvent | null> {
  const body = {
    contents: [{ role: "user", parts: [{ text: `${SYSTEM_PROMPT}\n\nCAPTION:\n${caption}` }] }],
    generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
  };
  return callGemini(env, body);
}

async function visionPass(
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
  return callGemini(env, body);
}

async function callGemini(env: Env, body: unknown): Promise<ParsedEvent | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
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
  return extractJson(text);
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
