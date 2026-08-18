import type { Env } from "../env.js";

export function yyyymm(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function currentUsage(env: Env, userHash: string): Promise<number> {
  const row = await env.DB.prepare("SELECT count FROM quota WHERE user_hash=? AND yyyymm=?")
    .bind(userHash, yyyymm(Date.now()))
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export function cap(env: Env): number {
  return Number(env.QUOTA_MONTHLY_CAP) || 5;
}

// Increment only on a successful conversion.
export async function increment(env: Env, userHash: string): Promise<number> {
  const month = yyyymm(Date.now());
  await env.DB.prepare(
    `INSERT INTO quota(user_hash, yyyymm, count) VALUES(?, ?, 1)
     ON CONFLICT(user_hash, yyyymm) DO UPDATE SET count = count + 1`,
  )
    .bind(userHash, month)
    .run();
  return currentUsage(env, userHash);
}
