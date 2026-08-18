import type { Env, ShareJob } from "./env.js";
import { verifyMetaSignature, hashUser } from "./lib/crypto.js";
import { extractShareMessages, sendDM, fetchPost, downloadMedia } from "./lib/meta.js";
import { parseCascade } from "./lib/parse.js";
import {
  buildPayload,
  googleCalendarUrl,
  buildIcs,
  signToken,
  verifyToken,
} from "./lib/calendar.js";
import { currentUsage, cap, increment } from "./lib/quota.js";
import { logConversion, logClick } from "./lib/log.js";
import { allow } from "./lib/rate.js";
import { M } from "./messages.js";

interface LinkToken {
  cid: number;             // conversion id (0 if not yet logged)
  kind: "gcal" | "ics";
  gcal?: string;           // for redirect kind=gcal
  payload?: {              // for ics kind
    title: string;
    start: string;
    end: string;
    location: string;
    description: string;
  };
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/webhook" && req.method === "GET") return verifyHandshake(url, env);
    if (url.pathname === "/webhook" && req.method === "POST") return handleWebhook(req, env, ctx);
    if (url.pathname.startsWith("/ics/")) return handleIcs(url, env);
    if (url.pathname.startsWith("/r/")) return handleRedirect(url, env, ctx);
    if (url.pathname === "/healthz") return new Response("ok");

    return new Response("Not found", { status: 404 });
  },

  async queue(batch: MessageBatch<ShareJob>, env: Env, _ctx: ExecutionContext): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await processShare(env, msg.body);
        msg.ack();
      } catch (err) {
        console.error("processShare failed", err);
        msg.retry();
      }
    }
  },
};

function verifyHandshake(url: URL, env: Env): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === env.META_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

async function handleWebhook(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const raw = await req.text();
  const sig = req.headers.get("x-hub-signature-256");
  const ok = await verifyMetaSignature(env.META_APP_SECRET, sig, raw);
  if (!ok) return new Response("bad signature", { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const messages = extractShareMessages(body as Parameters<typeof extractShareMessages>[0]);
  ctx.waitUntil(enqueueAndAck(env, messages));
  return new Response("ok", { status: 200 });
}

async function enqueueAndAck(env: Env, messages: ReturnType<typeof extractShareMessages>): Promise<void> {
  for (const m of messages) {
    const first = m.attachments[0];
    const job: ShareJob = {
      sender_id: m.sender_id,
      attachment_url: first?.payload.url,
      attachment_payload_id: first?.payload.id,
      received_at: Date.now(),
    };
    // Rate-limit check happens against a hashed sender.
    const userHash = await hashUser(env.USER_HASH_SALT, m.sender_id);
    if (!(await allow(env, userHash))) {
      await safeSend(env, m.sender_id, "Slow down — try again in a minute.");
      continue;
    }
    // Send ack immediately so the interaction stays inside the messaging window.
    await safeSend(env, m.sender_id, M.ack);
    await env.SHARE_QUEUE.send(job);
  }
}

async function safeSend(env: Env, recipient: string, text: string): Promise<void> {
  try {
    await sendDM(env, recipient, text);
  } catch (e) {
    console.error("sendDM error", e);
  }
}

async function processShare(env: Env, job: ShareJob): Promise<void> {
  const started = Date.now();
  const userHash = await hashUser(env.USER_HASH_SALT, job.sender_id);

  // Quota check.
  const used = await currentUsage(env, userHash);
  if (used >= cap(env)) {
    await safeSend(env, job.sender_id, M.quotaHit(cap(env)));
    await logConversion(env, {
      ts: Date.now(),
      user_hash: userHash,
      parse_outcome: "failed",
      latency_ms: Date.now() - started,
      quota_hit: true,
    });
    return;
  }

  let post;
  try {
    post = await fetchPost(env, { url: job.attachment_url, id: job.attachment_payload_id });
  } catch (e) {
    console.error("fetchPost error", e);
    await safeSend(env, job.sender_id, M.privatePost);
    await logConversion(env, {
      ts: Date.now(),
      user_hash: userHash,
      parse_outcome: "failed",
      latency_ms: Date.now() - started,
      quota_hit: false,
    });
    return;
  }

  let imageBytes: ArrayBuffer | undefined;
  let imageMime: string | undefined;
  if (post.media_url) {
    try {
      const dl = await downloadMedia(post.media_url);
      imageBytes = dl.bytes;
      imageMime = dl.mime;
    } catch (e) {
      console.error("downloadMedia error", e);
    }
  }

  const parsed = await parseCascade(env, { caption: post.caption, imageBytes, imageMime });

  if (parsed.outcome === "failed" || !parsed.start) {
    const msg =
      parsed.confidence === 0 && !post.caption?.match(/\d/)
        ? M.notAnEvent
        : M.parseFailed;
    await safeSend(env, job.sender_id, msg);
    await logConversion(env, {
      ts: Date.now(),
      user_hash: userHash,
      permalink: post.permalink,
      parse_outcome: "failed",
      confidence: parsed.confidence,
      latency_ms: Date.now() - started,
      quota_hit: false,
    });
    return;
  }

  const payload = buildPayload(parsed, { permalink: post.permalink, username: post.username });
  if (!payload) {
    await safeSend(env, job.sender_id, M.parseFailed);
    return;
  }

  const conversionId = await logConversion(env, {
    ts: Date.now(),
    user_hash: userHash,
    permalink: post.permalink,
    parse_outcome: parsed.outcome,
    confidence: parsed.confidence,
    latency_ms: Date.now() - started,
    quota_hit: false,
  });
  await increment(env, userHash);

  const gcalUrl = googleCalendarUrl(payload);
  const gcalToken = await signToken(env.LINK_SIGNING_SECRET, {
    cid: conversionId,
    kind: "gcal",
    gcal: gcalUrl,
  } as LinkToken);
  const icsToken = await signToken(env.LINK_SIGNING_SECRET, {
    cid: conversionId,
    kind: "ics",
    payload,
  } as LinkToken);
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const gcalLink = `${base}/r/${gcalToken}`;
  const icsLink = `${base}/ics/${icsToken}`;

  const when = formatWhen(payload.start, payload.end, parsed.timezone);
  const missing: string[] = [];
  if (!parsed.title) missing.push("title");
  if (!parsed.location) missing.push("location");
  const text =
    missing.length > 0
      ? M.partial(
          `• Title: ${payload.title}\n• When: ${when}\n• Where: ${payload.location || "unknown"}`,
          gcalLink,
          icsLink,
        )
      : M.success(payload.title, when, gcalLink, icsLink);
  await safeSend(env, job.sender_id, text);
}

function formatWhen(startIso: string, endIso: string, tz?: string): string {
  try {
    const start = new Date(startIso);
    const opts: Intl.DateTimeFormatOptions = {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
      timeZoneName: "short",
    };
    return new Intl.DateTimeFormat("en-US", opts).format(start);
  } catch {
    return `${startIso} → ${endIso}`;
  }
}

async function handleRedirect(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const token = url.pathname.slice("/r/".length);
  const t = await verifyToken<LinkToken>(env.LINK_SIGNING_SECRET, token);
  if (!t || t.kind !== "gcal" || !t.gcal) return new Response("bad link", { status: 400 });
  if (t.cid > 0) ctx.waitUntil(logClick(env, t.cid, "gcal"));
  return Response.redirect(t.gcal, 302);
}

async function handleIcs(url: URL, env: Env): Promise<Response> {
  const token = url.pathname.slice("/ics/".length);
  const t = await verifyToken<LinkToken>(env.LINK_SIGNING_SECRET, token);
  if (!t || t.kind !== "ics" || !t.payload) return new Response("bad link", { status: 400 });
  const uid = `${t.cid}@ig-share2calendar`;
  const body = buildIcs(t.payload, uid);
  if (t.cid > 0) {
    // Fire-and-forget click log; safe to skip if it fails.
    logClick(env, t.cid, "ics").catch(() => {});
  }
  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="event-${t.cid}.ics"`,
    },
  });
}
