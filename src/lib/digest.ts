import type { Env } from "../env.js";

// The whole point of §6 in the spec: read a real signal from the
// database each Monday and check the Phase-2 triggers from
// THRESHOLDS.md. Numbers here are the thresholds the doc committed to
// — keep them in sync if you edit the .md.
export const TRIGGERS = {
  weeklyMinConversions: 50,
  sustainedWeeksNeeded: 4,
  quotaPressureRatio: 0.2, // 20% of MAU hitting monthly cap
  quotaPressureMonthsNeeded: 2,
};

export interface Digest {
  ts: number;
  window: { start: number; end: number };
  conversions7d: number;
  successful7d: number;
  failed7d: number;
  dlq7d: number;
  activeUsers30d: number;
  quotaHitUsers30d: number;
  modelSplit30d: Array<{ model: string; n: number; avgConfidence: number }>;
  weeklyHistory: Array<{ weekStart: string; n: number }>;
  triggers: {
    volumeMet: boolean;
    volumeStreak: number;
    quotaPressureMet: boolean;
    quotaPressureRatio: number;
    anyMet: boolean;
  };
}

export async function buildDigest(env: Env): Promise<Digest> {
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const startWeek = now - 7 * day;
  const start30 = now - 30 * day;

  const conv7 = num(await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM conversions WHERE ts >= ?",
  ).bind(startWeek).first<{ n: number }>());
  const ok7 = num(await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM conversions WHERE ts >= ? AND parse_outcome != 'failed'",
  ).bind(startWeek).first<{ n: number }>());
  const failed7 = num(await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM conversions WHERE ts >= ? AND parse_outcome = 'failed'",
  ).bind(startWeek).first<{ n: number }>());
  const dlq7 = num(await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM dlq_events WHERE ts >= ?",
  ).bind(startWeek).first<{ n: number }>());
  const active30 = num(await env.DB.prepare(
    "SELECT COUNT(DISTINCT user_hash) AS n FROM conversions WHERE ts >= ?",
  ).bind(start30).first<{ n: number }>());
  const quotaHit30 = num(await env.DB.prepare(
    "SELECT COUNT(DISTINCT user_hash) AS n FROM conversions WHERE ts >= ? AND quota_hit = 1",
  ).bind(start30).first<{ n: number }>());

  const modelSplit = ((await env.DB.prepare(
    `SELECT COALESCE(model, 'unknown') AS model,
            COUNT(*) AS n,
            AVG(COALESCE(confidence, 0)) AS avg_confidence
     FROM conversions WHERE ts >= ? GROUP BY model ORDER BY n DESC`,
  ).bind(start30).all<{ model: string; n: number; avg_confidence: number }>()).results ?? [])
    .map((r) => ({ model: r.model, n: r.n, avgConfidence: round2(r.avg_confidence) }));

  const weeklyHistory = await lastNWeeklyCounts(env, TRIGGERS.sustainedWeeksNeeded);
  const streak = countTrailingWeeksAbove(weeklyHistory, TRIGGERS.weeklyMinConversions);
  const pressureRatio = active30 > 0 ? quotaHit30 / active30 : 0;

  const volumeMet = streak >= TRIGGERS.sustainedWeeksNeeded;
  const quotaPressureMet = pressureRatio >= TRIGGERS.quotaPressureRatio;

  return {
    ts: now,
    window: { start: startWeek, end: now },
    conversions7d: conv7,
    successful7d: ok7,
    failed7d: failed7,
    dlq7d: dlq7,
    activeUsers30d: active30,
    quotaHitUsers30d: quotaHit30,
    modelSplit30d: modelSplit,
    weeklyHistory,
    triggers: {
      volumeMet,
      volumeStreak: streak,
      quotaPressureMet,
      quotaPressureRatio: round2(pressureRatio),
      anyMet: volumeMet || quotaPressureMet,
    },
  };
}

async function lastNWeeklyCounts(env: Env, n: number): Promise<Array<{ weekStart: string; n: number }>> {
  const day = 24 * 3600 * 1000;
  const now = Date.now();
  const out: Array<{ weekStart: string; n: number }> = [];
  for (let i = n - 1; i >= 0; i--) {
    const end = now - i * 7 * day;
    const start = end - 7 * day;
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM conversions WHERE ts >= ? AND ts < ? AND parse_outcome != 'failed'",
    ).bind(start, end).first<{ n: number }>();
    out.push({ weekStart: isoDate(start), n: row?.n ?? 0 });
  }
  return out;
}

function countTrailingWeeksAbove(hist: Array<{ n: number }>, minN: number): number {
  let streak = 0;
  for (let i = hist.length - 1; i >= 0; i--) {
    if ((hist[i]?.n ?? 0) >= minN) streak++;
    else break;
  }
  return streak;
}

function num<T extends { n?: number }>(row: T | null | undefined): number {
  return row?.n ?? 0;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// Slack/Discord incoming webhooks both accept a plain-text `text`
// field, and both ignore extra fields. Keeping the payload minimal so
// one URL fits both surfaces.
export function formatDigest(d: Digest): string {
  const parseRate = d.conversions7d ? Math.round((d.successful7d / d.conversions7d) * 100) : 0;
  const modelLine = d.modelSplit30d
    .map((m) => `${m.model} ${m.n}(conf ${m.avgConfidence})`)
    .join(" · ") || "(no data)";
  const history = d.weeklyHistory.map((w) => `${w.weekStart}:${w.n}`).join(" ");
  const triggerLine = d.triggers.anyMet
    ? `⚠ Phase-2 trigger met — volume streak ${d.triggers.volumeStreak}, quota pressure ${d.triggers.quotaPressureRatio}. Time to open the design doc.`
    : `No trigger met (streak ${d.triggers.volumeStreak}/${TRIGGERS.sustainedWeeksNeeded}, quota pressure ${d.triggers.quotaPressureRatio}/${TRIGGERS.quotaPressureRatio}).`;
  return [
    `*IG Share2Calendar — weekly digest*`,
    `7d: ${d.conversions7d} shares, ${d.successful7d} converted (${parseRate}%), ${d.failed7d} failed, ${d.dlq7d} dead-lettered.`,
    `30d: ${d.activeUsers30d} MAU, ${d.quotaHitUsers30d} hit quota.`,
    `Model split (30d): ${modelLine}`,
    `Weekly successes: ${history}`,
    triggerLine,
  ].join("\n");
}

export interface DeliveryResult {
  webhookPosted: boolean;
  webhookStatus?: number;
  kvStored: boolean;
}

const LAST_KEY = "digest:last";

export async function deliverDigest(env: Env, d: Digest): Promise<DeliveryResult> {
  const text = formatDigest(d);
  let webhookPosted = false;
  let webhookStatus: number | undefined;
  if (env.DIGEST_WEBHOOK_URL) {
    try {
      const res = await fetch(env.DIGEST_WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, digest: d }),
      });
      webhookPosted = res.ok;
      webhookStatus = res.status;
    } catch (e) {
      console.error("digest webhook failed", e);
    }
  }
  try {
    await env.RATE_KV.put(LAST_KEY, JSON.stringify({ text, digest: d }), {
      // 8 weeks so a missed cron is still visible on next login.
      expirationTtl: 8 * 7 * 24 * 3600,
    });
  } catch (e) {
    console.error("digest KV persist failed", e);
    return { webhookPosted, webhookStatus, kvStored: false };
  }
  return { webhookPosted, webhookStatus, kvStored: true };
}

export async function loadLastDigest(env: Env): Promise<{ text: string; digest: Digest } | null> {
  try {
    const raw = await env.RATE_KV.get(LAST_KEY, "json");
    return (raw as { text: string; digest: Digest } | null) ?? null;
  } catch {
    return null;
  }
}
