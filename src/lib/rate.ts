import type { Env } from "../env.js";

// Simple fixed-window per-user throttle: N shares per minute.
const WINDOW_SEC = 60;
const MAX_PER_WINDOW = 5;

export async function allow(env: Env, userHash: string): Promise<boolean> {
  const key = `rl:${userHash}:${Math.floor(Date.now() / (WINDOW_SEC * 1000))}`;
  const cur = (await env.RATE_KV.get(key, "text")) ?? "0";
  const n = Number(cur) + 1;
  if (n > MAX_PER_WINDOW) return false;
  await env.RATE_KV.put(key, String(n), { expirationTtl: WINDOW_SEC * 2 });
  return true;
}
