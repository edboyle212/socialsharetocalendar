import type { Env } from "../../env.js";
import { GeminiParser } from "./gemini.js";
import { WorkersAiParser } from "./workers_ai.js";
import type { Parser, ParserInput, ParserResult } from "./types.js";

export type ParserId = "gemini" | "workers-ai";

const REGISTRY: Record<ParserId, Parser> = {
  "gemini": GeminiParser,
  "workers-ai": WorkersAiParser,
};

export function primaryParser(env: Env): ParserId {
  const raw = (env.PARSER_PRIMARY ?? "gemini").toLowerCase();
  return raw === "workers-ai" ? "workers-ai" : "gemini";
}

// Available means "we have what this parser needs to run". Gemini
// wants an API key; Workers AI wants the AI binding to exist.
export function available(env: Env, id: ParserId): boolean {
  if (id === "gemini") return !!env.GEMINI_API_KEY;
  if (id === "workers-ai") return !!(env as unknown as { AI?: unknown }).AI;
  return false;
}

function order(env: Env): ParserId[] {
  const p = primaryParser(env);
  const fb: ParserId = p === "gemini" ? "workers-ai" : "gemini";
  return [p, fb].filter((id) => available(env, id));
}

// Public API. Tries the primary parser; if it throws or returns a
// low-confidence failure, falls through to the fallback. Every result
// is tagged with the model that produced it.
export async function runCascade(env: Env, input: ParserInput): Promise<ParserResult> {
  const chain = order(env);
  if (chain.length === 0) {
    return { confidence: 0, outcome: "failed", model: "none" };
  }
  let last: ParserResult | null = null;
  for (const id of chain) {
    try {
      const r = await REGISTRY[id].parse(env, input);
      if (r.outcome !== "failed" && r.start) return r;
      last = r;
    } catch (e) {
      console.error(`parser ${id} threw`, e);
      last = { confidence: 0, outcome: "failed", model: `${id}/error` };
    }
  }
  return last ?? { confidence: 0, outcome: "failed", model: "none" };
}

// Try the primary parser's refine() first, then the fallback's. Returns
// { event, model } on success or null if both refuse. We deliberately
// don't merge fields ourselves — the LLM is much better at "keep the
// bits I didn't correct" than a regex would be.
export async function runRefine(
  env: Env,
  current: import("./types.js").ParsedEvent,
  correction: string,
): Promise<{ event: import("./types.js").ParsedEvent; model: string } | null> {
  for (const id of order(env)) {
    const p = REGISTRY[id];
    if (!p.refine) continue;
    try {
      const revised = await p.refine(env, current, correction);
      if (revised) return { event: revised, model: `${p.id}/refine` };
    } catch (e) {
      console.error(`refine ${id} threw`, e);
    }
  }
  return null;
}

export type { Parser, ParserInput, ParserResult };
export type { ParsedEvent } from "./types.js";
