import type { Env } from "../env.js";
import { hashUser, sha256Hex } from "./crypto.js";

export interface DeletionResult {
  code: string;
  url: string;
}

// Erases every row associated with a given IG user id (or its already-
// hashed form). Returns a short code the caller can echo back so the
// user can look up their deletion status.
export async function eraseUser(env: Env, senderId: string): Promise<DeletionResult> {
  const userHash = await hashUser(env.USER_HASH_SALT, senderId);
  const code = (await sha256Hex(`${userHash}:${Date.now()}`)).slice(0, 12);

  // D1 doesn't accept multi-statement in prepare().run(); batch it.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM conversions WHERE user_hash = ?").bind(userHash),
    env.DB.prepare("DELETE FROM quota WHERE user_hash = ?").bind(userHash),
    env.DB.prepare(
      "INSERT INTO deletion_requests(code, user_hash, ts, status) VALUES(?, ?, ?, 'completed')",
    ).bind(code, userHash, Date.now()),
  ]);

  const base = env.PUBLIC_BASE_URL.replace(/\/$/, "");
  return { code, url: `${base}/deletion?code=${code}` };
}
