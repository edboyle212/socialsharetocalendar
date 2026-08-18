import type { Env } from "../env.js";

export interface ConversionRow {
  ts: number;
  user_hash: string;
  permalink?: string;
  parse_outcome: "caption" | "vision" | "failed";
  confidence?: number;
  latency_ms: number;
  quota_hit: boolean;
  model?: string;
}

export async function logConversion(env: Env, row: ConversionRow): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO conversions (ts, user_hash, permalink, parse_outcome, confidence, latency_ms, quota_hit, model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.ts,
      row.user_hash,
      row.permalink ?? null,
      row.parse_outcome,
      row.confidence ?? null,
      row.latency_ms,
      row.quota_hit ? 1 : 0,
      row.model ?? null,
    )
    .run();
  const id = (res.meta as { last_row_id?: number } | undefined)?.last_row_id;
  return id ?? 0;
}

export async function logClick(env: Env, conversionId: number, kind: "gcal" | "ics"): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO link_clicks (ts, conversion_id, kind) VALUES (?, ?, ?)`,
  )
    .bind(Date.now(), conversionId, kind)
    .run();
}
