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

// Llama 3.2 11B Vision on Cloudflare Workers AI. In-Worker binding, so
// no external HTTP, no API key, no egress. See:
//   https://developers.cloudflare.com/workers-ai/models/llama-3.2-11b-vision-instruct/
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct";

interface AiResponse {
  response?: string;
}

interface WorkersAiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}

function ai(env: Env): WorkersAiBinding {
  const binding = (env as unknown as { AI?: WorkersAiBinding }).AI;
  if (!binding) throw new Error("workers-ai: AI binding is not present");
  return binding;
}

export const WorkersAiParser: Parser = {
  id: `workers-ai/${VISION_MODEL}`,

  async parse(env: Env, input: ParserInput): Promise<ParserResult> {
    const th = threshold(env);

    if (input.caption?.trim()) {
      const p = await textPass(env, input.caption);
      if (p && p.confidence >= th && p.start) {
        return { ...p, outcome: "caption", model: `workers-ai/${TEXT_MODEL}` };
      }
    }
    if (input.imageBytes) {
      const v = await visionPass(env, input.imageBytes, input.caption);
      if (v && v.confidence >= th && v.start) {
        return { ...v, outcome: "vision", model: this.id };
      }
      if (v) return { ...v, outcome: "failed", model: this.id };
    }
    return { confidence: 0, outcome: "failed", model: this.id };
  },

  async refine(env: Env, current: ParsedEvent, correction: string): Promise<ParsedEvent | null> {
    const raw = await ai(env).run(TEXT_MODEL, {
      messages: [
        { role: "system", content: REFINE_PROMPT },
        { role: "user", content: `CURRENT_EVENT:\n${JSON.stringify(current)}\n\nCORRECTION:\n${correction}` },
      ],
      temperature: 0.1,
      max_tokens: 512,
    });
    return textOf(raw);
  },
};

async function textPass(env: Env, caption: string): Promise<ParsedEvent | null> {
  const raw = await ai(env).run(TEXT_MODEL, {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `CAPTION:\n${caption}` },
    ],
    temperature: 0.1,
    max_tokens: 512,
  });
  return textOf(raw);
}

async function visionPass(
  env: Env,
  bytes: ArrayBuffer,
  caption?: string,
): Promise<ParsedEvent | null> {
  // Workers AI vision takes the image as a byte array.
  const image = Array.from(new Uint8Array(bytes));
  const raw = await ai(env).run(VISION_MODEL, {
    prompt: `${SYSTEM_PROMPT}\n\nCAPTION (may be empty):\n${caption ?? ""}`,
    image,
    temperature: 0.1,
    max_tokens: 512,
  });
  return textOf(raw);
}

function textOf(raw: unknown): ParsedEvent | null {
  const text = (raw as AiResponse | undefined)?.response;
  if (!text) return null;
  return extractJson(text);
}
