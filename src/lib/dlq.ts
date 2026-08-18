import type { Env, ShareJob } from "../env.js";
import { hashUser } from "./crypto.js";
import { sendDM } from "./meta.js";

// A job lands here after the queue has exhausted retries. Two duties:
//   1. log it so an operator can see the failure pattern from /admin.
//   2. tell the user we bailed out — as long as the original share was
//      recent enough to still be inside the 24h IG messaging window.
const IG_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function handleDeadLetter(env: Env, job: ShareJob): Promise<void> {
  const userHash = await hashUser(env.USER_HASH_SALT, job.sender_id);
  const withinWindow = Date.now() - job.received_at < IG_WINDOW_MS;
  let notified = false;
  if (withinWindow) {
    try {
      await sendDM(
        env,
        job.sender_id,
        "Something went wrong reading that post — sorry. Try sharing it again in a minute; the issue is on my side.",
      );
      notified = true;
    } catch (e) {
      console.error("dlq sendDM failed", e);
    }
  }
  try {
    await env.DB.prepare(
      `INSERT INTO dlq_events (ts, user_hash, sender_id, received_at, attachment_url, notified_user)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        Date.now(),
        userHash,
        job.sender_id,
        job.received_at,
        job.attachment_url ?? null,
        notified ? 1 : 0,
      )
      .run();
  } catch (e) {
    console.error("dlq log failed", e);
  }
}
