import type { Env } from "../env.js";
import type { ParsedEvent } from "./parsers/types.js";

// When a share only half-parses, we stash the extracted event + post
// context in KV keyed by the user's hash so a follow-up text message
// ("TZ Europe/Berlin", "at 9pm", "actually the venue is X") can revise
// it without re-fetching or re-hitting the model image path.
const TTL_SECONDS = 60 * 60; // 1h — long enough for a real conversation, short enough not to leak

const KEY = (userHash: string) => `pending:${userHash}`;

export interface PendingContext {
  permalink?: string;
  username?: string;
}

export interface PendingParse {
  event: ParsedEvent;
  ctx: PendingContext;
  createdAt: number;
}

export async function savePending(env: Env, userHash: string, value: PendingParse): Promise<void> {
  try {
    await env.RATE_KV.put(KEY(userHash), JSON.stringify(value), {
      expirationTtl: TTL_SECONDS,
    });
  } catch (e) {
    // Losing pending state is a UX degradation, not a correctness bug.
    console.error("savePending failed", e);
  }
}

export async function loadPending(env: Env, userHash: string): Promise<PendingParse | null> {
  try {
    return (await env.RATE_KV.get(KEY(userHash), "json")) as PendingParse | null;
  } catch {
    return null;
  }
}

export async function clearPending(env: Env, userHash: string): Promise<void> {
  try {
    await env.RATE_KV.delete(KEY(userHash));
  } catch { /* noop */ }
}
