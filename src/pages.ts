// Static pages required by Meta app review: privacy policy, terms of
// service, and a human-readable data-deletion instructions page linked
// from the JSON callback response.

const HEAD = (title: string) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>
:root { color-scheme: light dark; }
body { max-width: 720px; margin: 3rem auto; padding: 0 1rem;
  font: 16px/1.55 -apple-system, system-ui, sans-serif; }
h1 { font-size: 1.6rem; margin-bottom: .25rem; }
h2 { margin-top: 2rem; font-size: 1.15rem; }
.updated { color: #888; font-size: .9rem; }
code { background: rgba(127,127,127,.15); padding: 0 .25rem; border-radius: 3px; }
</style>
</head><body>`;
const FOOT = `</body></html>`;

export function privacyPage(): string {
  return `${HEAD("Privacy Policy — IG Share2Calendar")}
<h1>Privacy Policy</h1>
<p class="updated">Last updated: 2026-08-18</p>

<p>IG Share2Calendar (the "Service") is a personal utility that turns
Instagram posts shared to it into calendar events. This page describes
what data the Service handles and for how long.</p>

<h2>What we receive</h2>
<ul>
  <li>Instagram user ID of the person who shared a post (from Meta's
    webhook), plus the message ID of the share.</li>
  <li>The shared post's public metadata: caption, media URL,
    permalink, author handle.</li>
  <li>The image bytes for OCR/vision parsing when the caption is
    insufficient. Bytes are held only for the duration of a single
    request; nothing is stored.</li>
</ul>

<h2>What we store</h2>
<ul>
  <li>A <strong>hashed</strong> version of your Instagram user ID
    (SHA-256 with a server-side salt) so we can enforce the monthly
    quota and count conversions. The raw ID is not stored.</li>
  <li>Per-conversion: timestamp, parse outcome, latency, and the
    post permalink (for support). No caption text is stored.</li>
  <li>Which of the two calendar links you tapped (Google Calendar
    or <code>.ics</code>), when measurable.</li>
</ul>

<h2>What we do not do</h2>
<ul>
  <li>No advertising, no third-party analytics, no data sale.</li>
  <li>No profile of your Instagram activity beyond the shares you
    explicitly send to the bot.</li>
  <li>No reminders or follow-up messages — your calendar app handles that.</li>
</ul>

<h2>Retention</h2>
<p>Conversion rows are kept for 13 months for month-over-month trend
analysis, then deleted. Deletion requests (see below) remove all rows
associated with your hashed ID immediately.</p>

<h2>Third parties</h2>
<ul>
  <li><strong>Meta Platforms</strong> — Instagram Graph API, for
    webhook delivery and reply DMs.</li>
  <li><strong>Google (Gemini)</strong> — for caption and image
    parsing; caption text and image bytes are sent per request and
    are subject to Google's Gemini API data policies.</li>
  <li><strong>Cloudflare</strong> — hosting (Workers, D1, KV, Queues).</li>
</ul>

<h2>Deleting your data</h2>
<p>See the <a href="/deletion">data deletion page</a>. You can also
remove the bot from your Instagram DMs at any time; Meta will send
us a deletion callback and we will erase your rows automatically.</p>

<h2>Contact</h2>
<p>Questions: <a href="mailto:eboyle@medicibank.us">eboyle@medicibank.us</a></p>
${FOOT}`;
}

export function termsPage(): string {
  return `${HEAD("Terms — IG Share2Calendar")}
<h1>Terms of Service</h1>
<p class="updated">Last updated: 2026-08-18</p>

<h2>What the Service does</h2>
<p>Reads Instagram posts you share to the bot and replies with an
"add to calendar" link. Nothing else. No reminders, no follow-ups.</p>

<h2>Limits</h2>
<ul>
  <li>Free tier: 5 successful conversions per calendar month per user.</li>
  <li>Best-effort parsing. Extracted event details may be wrong; verify
    before relying on them.</li>
  <li>The Service is provided as-is, without warranty. Do not rely on
    it for time-critical events.</li>
</ul>

<h2>Acceptable use</h2>
<p>Do not use the Service to process content you are not permitted
to view under Instagram's terms. Do not attempt to overwhelm the
Service; per-user rate limits apply.</p>

<h2>Termination</h2>
<p>We may block accounts that abuse the Service. You may stop using
it at any time and request deletion of your stored data via the
<a href="/deletion">data deletion page</a>.</p>

<h2>Contact</h2>
<p><a href="mailto:eboyle@medicibank.us">eboyle@medicibank.us</a></p>
${FOOT}`;
}

export function deletionInfoPage(code?: string): string {
  const codeBlock = code
    ? `<p>Your deletion confirmation code: <code>${escapeHtml(code)}</code></p>`
    : "";
  return `${HEAD("Data Deletion — IG Share2Calendar")}
<h1>Data Deletion</h1>
<p>To delete data the Service has stored about you:</p>
<ol>
  <li>Open the bot's DM in Instagram.</li>
  <li>Send the message <code>DELETE MY DATA</code>.</li>
  <li>Or, remove the bot from your Instagram messages — Meta will
    notify us to erase your rows automatically.</li>
</ol>
${codeBlock}
<p>All rows associated with your hashed user ID are removed
immediately upon receipt of the callback. No retention is required.</p>
<p>Questions: <a href="mailto:eboyle@medicibank.us">eboyle@medicibank.us</a></p>
${FOOT}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
