import type { Env, ShareJob } from "./env.js";
import { verifyMetaSignature, hashUser } from "./lib/crypto.js";
import { extractShareMessages, sendDM, fetchPost, downloadMedia } from "./lib/meta.js";
import { runCascade } from "./lib/parsers/index.js";
import {
  buildPayload,
  googleCalendarUrl,
  buildIcs,
  signToken,
  verifyToken,
} from "./lib/calendar.js";
import { normalizeTime } from "./lib/tz.js";
import { currentUsage, cap, increment } from "./lib/quota.js";
import { logConversion, logClick } from "./lib/log.js";
import { allow } from "./lib/rate.js";
import { seenBefore } from "./lib/idempotency.js";
import { eraseUser } from "./lib/deletion.js";
import { parseSignedRequest } from "./lib/signed_request.js";
import { handleAdmin } from "./admin.js";
import { privacyPage, termsPage, deletionInfoPage } from "./pages.js";
import { handleDeadLetter } from "./lib/dlq.js";
import { buildDigest, deliverDigest } from "./lib/digest.js";
import { M } from "./messages.js";

interface LinkToken {
  cid: number;             // conversion id (0 if not yet logged)
  kind: "gcal" | "ics";
  gcal?: string;           // for redirect kind=gcal
  payload?: {              // for ics kind
    title: string;
    start: string;
    end: string;
    floating: boolean;
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
    if (url.pathname === "/deauthorize" && req.method === "POST") return handleDeauthorize(req, env);
    if (url.pathname === "/data-deletion" && req.method === "POST") return handleDataDeletion(req, env);
    if (url.pathname === "/deletion") return htmlResponse(deletionInfoPage(url.searchParams.get("code") ?? undefined));
    if (url.pathname === "/privacy") return htmlResponse(privacyPage());
    if (url.pathname === "/terms") return htmlResponse(termsPage());
    if (url.pathname.startsWith("/admin")) return handleAdmin(req, env);
    if (url.pathname === "/healthz") return new Response("ok");
    if (url.pathname === "/") return htmlResponse(landingPage());

    return new Response("Not found", { status: 404 });
  },

  async queue(batch: MessageBatch<ShareJob>, env: Env, _ctx: ExecutionContext): Promise<void> {
    // One handler serves both queues; dispatch by batch.queue.
    if (batch.queue === "share-events-dlq") {
      for (const msg of batch.messages) {
        try {
          await handleDeadLetter(env, msg.body);
        } catch (e) {
          console.error("dlq handler failed", e);
        }
        msg.ack(); // dead-letter processing is best-effort; don't retry
      }
      return;
    }
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

  async scheduled(_ctrl: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Cron cadence is set in wrangler.toml. Right now: Mondays 14:00 UTC.
    ctx.waitUntil((async () => {
      try {
        const d = await buildDigest(env);
        await deliverDigest(env, d);
      } catch (e) {
        console.error("scheduled digest failed", e);
      }
    })());
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
    if (await seenBefore(env, m.sender_id, m.mid)) continue;

    // In-DM deletion shortcut.
    if ((m.text ?? "").trim().toUpperCase() === "DELETE MY DATA") {
      try {
        const { code, url: deletionUrl } = await eraseUser(env, m.sender_id);
        await safeSend(
          env,
          m.sender_id,
          `Done — your rows have been deleted. Confirmation code: ${code}\n${deletionUrl}`,
        );
      } catch (e) {
        console.error("eraseUser error", e);
        await safeSend(env, m.sender_id, M.genericError);
      }
      continue;
    }

    // Ignore plain text messages we can't act on.
    if (m.attachments.length === 0) continue;

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

  const parsed = await runCascade(env, { caption: post.caption, imageBytes, imageMime });

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
      model: parsed.model,
    });
    return;
  }

  // Resolve naive local times against the parsed timezone. If Gemini
  // gave us no TZ (unusual — the prompt requires it whenever a
  // location signal exists), we fall back to floating time: no fixed
  // instant, the user's calendar app shows it in whatever TZ they
  // open it in. We still surface that fact in the reply.
  const startNorm = normalizeTime(parsed.start!, parsed.timezone);
  const endNorm = parsed.end ? normalizeTime(parsed.end, parsed.timezone) : startNorm;
  const floating = startNorm.floating;
  const resolvedTz = startNorm.assumedTz ?? parsed.timezone;

  const payload = buildPayload(
    { ...parsed, start: startNorm.iso, end: endNorm.iso },
    { permalink: post.permalink, username: post.username },
    { floating },
  );
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
    model: parsed.model,
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

  const when = formatWhen(payload.start, payload.end, resolvedTz, floating);
  const missing: string[] = [];
  if (!parsed.title) missing.push("title");
  if (!parsed.location) missing.push("location");
  if (floating) missing.push("timezone");
  const fields = `• Title: ${payload.title}\n• When: ${when}\n• Where: ${payload.location || "unknown"}${
    floating ? "\n• Timezone: not detected (shown as local to you)" : ""
  }`;
  const text = missing.length > 0
    ? M.partial(fields, gcalLink, icsLink)
    : M.success(payload.title, when, gcalLink, icsLink);
  await safeSend(env, job.sender_id, text);
}

function formatWhen(startIso: string, endIso: string, tz: string | undefined, floating: boolean): string {
  try {
    if (floating) {
      // Naive: render the wall-clock we were given, without pretending
      // to know a UTC offset.
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(startIso);
      if (!m) return `${startIso} → ${endIso}`;
      const [_, y, mo, d, h, mi] = m;
      const asUtc = new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!));
      return new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
      }).format(asUtc) + " (local)";
    }
    const opts: Intl.DateTimeFormatOptions = {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
      timeZoneName: "short",
    };
    return new Intl.DateTimeFormat("en-US", opts).format(new Date(startIso));
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

// Meta calls this when a user removes the app from their account. Body
// is a form-encoded `signed_request=<sig>.<payload>`.
async function handleDeauthorize(req: Request, env: Env): Promise<Response> {
  const form = await req.formData();
  const signed = form.get("signed_request");
  if (typeof signed !== "string") return new Response("bad request", { status: 400 });
  const p = await parseSignedRequest(env.META_APP_SECRET, signed);
  if (!p?.user_id) return new Response("unauthorized", { status: 401 });
  await eraseUser(env, p.user_id);
  return new Response("ok");
}

// Data deletion request callback. Same envelope as above; Meta wants
// JSON back with a URL and confirmation code the user can check.
async function handleDataDeletion(req: Request, env: Env): Promise<Response> {
  const form = await req.formData();
  const signed = form.get("signed_request");
  if (typeof signed !== "string") return new Response("bad request", { status: 400 });
  const p = await parseSignedRequest(env.META_APP_SECRET, signed);
  if (!p?.user_id) return new Response("unauthorized", { status: 401 });
  const result = await eraseUser(env, p.user_id);
  return new Response(
    JSON.stringify({ url: result.url, confirmation_code: result.code }),
    { headers: { "content-type": "application/json" } },
  );
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function landingPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>IG Share2Calendar</title>
<style>body{max-width:640px;margin:4rem auto;padding:0 1rem;font:16px/1.55 -apple-system,system-ui,sans-serif;color-scheme:light dark}h1{font-size:1.6rem}a{color:inherit}</style>
</head><body>
<h1>IG Share2Calendar</h1>
<p>Share an Instagram post to the bot's DM; get back a calendar link. That's it.</p>
<p><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/deletion">Data deletion</a></p>
</body></html>`;
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
