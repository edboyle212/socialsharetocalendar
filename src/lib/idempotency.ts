import type { Env } from "../env.js";

// Meta retries webhooks on any non-2xx or network hiccup. Every message
// carries a `mid`; dedupe on (sender, mid). Rows are pruned lazily by
// the admin endpoint; not important for MVP volume.
export async function seenBefore(env: Env, senderId: string, mid: string | undefined): Promise<boolean> {
  if (!mid) return false;
  const key = `${senderId}:${mid}`;
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
