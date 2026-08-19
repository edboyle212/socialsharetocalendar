import type { Env } from "../env.js";

// Meta retries webhooks on any non-2xx or network hiccup. Callers name
// a namespace so IDs from different webhook fields (message MIDs,
// comment IDs, mention IDs) can't collide.
export async function seenBefore(env: Env, namespace: string, id: string | undefined): Promise<boolean> {
  if (!id) return false;
  const key = `${namespace}:${id}`;
  try {
    const res = await env.DB.prepare(
      "INSERT OR IGNORE INTO seen_messages(key, ts) VALUES(?, ?)",
    )
      .bind(key, Date.now())
      .run();
    // changes === 0 means row already existed → dup
    const changes = (res.meta as { changes?: number } | undefined)?.changes ?? 0;
    return changes === 0;
  } catch {
    // Never block on the dedupe path; better to occasionally double-reply
    // than to silently drop.
    return false;
  }
}
