import type { Env, MentionJob } from "../env.js";
import { fetchMentionedComment, fetchMentionedMedia, replyToComment, downloadMedia } from "./meta.js";
import { runCascade } from "./parsers/index.js";
import { buildPayload, googleCalendarUrl, buildIcs, signToken } from "./calendar.js";
import { normalizeTime } from "./tz.js";
import { hashUser } from "./crypto.js";
import { logConversion } from "./log.js";
import { M } from "../messages.js";

// A user @-tagged the bot in a comment on an IG post (may be their own,
// may be someone else's). Meta gives us media_id + comment_id. We fetch
// the post's caption/media via the mentioned_media Graph edge, run the
// same parse cascade the DM path uses, and reply directly in the
// comment thread. If parsing fails, drop a short CTA so the user can
// convert via DM (which opens the 24h window).

interface CalendarPayloadLike {
  title: string;
  start: string;
  end: string;
  floating: boolean;
  location: string;
  description: string;
}

interface LinkToken {
  cid: number;
  kind: "gcal" | "ics";
  gcal?: string;
  payload?: CalendarPayloadLike;
}

export async function handleMention(env: Env, job: MentionJob): Promise<void> {
  if (!job.comment_id) {
    // Caption mentions have no comment thread we can reply into. Skip
    // for now; they'd need a different reply strategy (private-reply
    // to the mentioning user, gated by whether they follow the bot).
    return;
  }
  const started = Date.now();
  const [post, commentInfo] = await Promise.all([
    fetchMentionedMedia(env, job.ig_user_id, job.media_id),
    fetchMentionedComment(env, job.ig_user_id, job.comment_id),
  ]);

  const username = commentInfo?.username;
  // A stable user hash for logging even though we don't know the
  // commenter's IG user ID (the API only exposes their username).
  const userHash = username
    ? await hashUser(env.USER_HASH_SALT, `ig-comment:${username}`)
    : await hashUser(env.USER_HASH_SALT, `ig-comment-anon:${job.comment_id}`);

  if (!post) {
    await safeReply(env, job.comment_id, M.commentCta(username));
    await logConversion(env, {
      ts: Date.now(),
      user_hash: userHash,
      permalink: undefined,
      parse_outcome: "failed",
      latency_ms: Date.now() - started,
      quota_hit: false,
      source: "comment_cta",
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
      console.error("mention: downloadMedia error", e);
    }
  }

  const parsed = await runCascade(env, { caption: post.caption, imageBytes, imageMime });
  if (parsed.outcome === "failed" || !parsed.start) {
    await safeReply(env, job.comment_id, M.commentCta(username));
    await logConversion(env, {
      ts: Date.now(),
      user_hash: userHash,
      permalink: post.permalink,
      parse_outcome: "failed",
      confidence: parsed.confidence,
      latency_ms: Date.now() - started,
      quota_hit: false,
      model: parsed.model,
      source: "comment_cta",
    });
    return;
  }

  const startNorm = normalizeTime(parsed.start, parsed.timezone);
  const endNorm = parsed.end ? normalizeTime(parsed.end, parsed.timezone) : startNorm;
  const floating = startNorm.floating;
  const resolvedTz = startNorm.assumedTz ?? parsed.timezone;

  const payload = buildPayload(
    { ...parsed, start: startNorm.iso, end: endNorm.iso },
    { permalink: post.permalink, username },
    { floating },
  );
  if (!payload) {
    await safeReply(env, job.comment_id, M.commentCta(username));
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
    source: "comment_mention",
  });

  const gcalUrl = googleCalendarUrl(payload);
  const gcalToken = await signToken(env.LINK_SIGNING_SECRET, {
    cid: conversionId,
    kind: "gcal",
    gcal: gcalUrl,
  } as LinkToken);
  // ICS token isn't linked from the public comment (calendar apps
  // handle .ics downloads awkwardly on mobile web); we only expose the
  // Google Calendar redirect there.
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const gcalLink = `${base}/r/${gcalToken}`;

  const when = formatWhenPublic(payload.start, payload.end, resolvedTz, floating);
  await safeReply(env, job.comment_id, M.commentLink(username, when, gcalLink));

  // Also build an ICS token so the redirect logs a click destination
  // consistent with the DM path if the user ever taps it manually.
  // (We can add a "reply with .ics link" if analytics later say people
  // want the file too.)
  await signToken(env.LINK_SIGNING_SECRET, {
    cid: conversionId,
    kind: "ics",
    payload,
  } as LinkToken);
}

async function safeReply(env: Env, commentId: string, message: string): Promise<void> {
  try {
    await replyToComment(env, commentId, message);
  } catch (e) {
    console.error("mention: replyToComment failed", e);
  }
}

function formatWhenPublic(startIso: string, endIso: string, tz: string | undefined, floating: boolean): string {
  try {
    if (floating) {
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
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
      timeZoneName: "short",
    }).format(new Date(startIso));
  } catch {
    return startIso;
  }
}
