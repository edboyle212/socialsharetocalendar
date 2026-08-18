import type { Env } from "./env.js";
import { primaryParser, available } from "./lib/parsers/index.js";

// The admin wizard is a single self-contained HTML page. It is gated
// by a bearer token stored as the ADMIN_TOKEN secret. The page's own
// XHRs re-send the token, so keep it out of logs.

interface Health {
  metaVerifyTokenSet: boolean;
  metaAppSecretSet: boolean;
  metaPageTokenSet: boolean;
  geminiKeySet: boolean;
  linkSigningSecretSet: boolean;
  userHashSaltSet: boolean;
  publicBaseUrl: string;
  webhookUrl: string;
  verifyToken: string;      // shown so operator can paste into Meta UI
  d1Ok: boolean;
  kvOk: boolean;
  queueBound: boolean;
  parserPrimary: "gemini" | "workers-ai";
  parserFallback: "gemini" | "workers-ai" | null;
  geminiAvailable: boolean;
  workersAiAvailable: boolean;
}

function authOk(env: Env, req: Request): boolean {
  const token = env.ADMIN_TOKEN;
  if (!token) return false;
  const h = req.headers.get("authorization");
  if (h?.startsWith("Bearer ")) return timingEq(h.slice(7), token);
  const url = new URL(req.url);
  const q = url.searchParams.get("t");
  return !!q && timingEq(q, token);
}

function timingEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function requireAuth(env: Env, req: Request): Response | null {
  if (!env.ADMIN_TOKEN) {
    return new Response(
      "ADMIN_TOKEN is not set. Run: wrangler secret put ADMIN_TOKEN",
      { status: 503 },
    );
  }
  if (!authOk(env, req)) {
    return new Response("unauthorized", {
      status: 401,
      headers: { "www-authenticate": 'Bearer realm="admin"' },
    });
  }
  return null;
}

export async function handleAdmin(req: Request, env: Env): Promise<Response> {
  const bad = requireAuth(env, req);
  if (bad) return bad;
  const url = new URL(req.url);

  if (url.pathname === "/admin") {
    return new Response(renderPage(), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  if (url.pathname === "/admin/health") {
    return json(await health(env, url));
  }
  if (url.pathname === "/admin/test/meta") return json(await testMeta(env));
  if (url.pathname === "/admin/test/gemini") return json(await testGemini(env));
  if (url.pathname === "/admin/test/ai") return json(await testAi(env));
  if (url.pathname === "/admin/test/d1") return json(await testD1(env));
  if (url.pathname === "/admin/test/kv") return json(await testKv(env));
  if (url.pathname === "/admin/stats") return json(await stats(env));

  return new Response("not found", { status: 404 });
}

function json(v: unknown): Response {
  return new Response(JSON.stringify(v), {
    headers: { "content-type": "application/json" },
  });
}

async function health(env: Env, url: URL): Promise<Health> {
  const base = env.PUBLIC_BASE_URL || `${url.protocol}//${url.host}`;
  let d1Ok = false, kvOk = false;
  try {
    await env.DB.prepare("SELECT 1 AS x").first();
    d1Ok = true;
  } catch { /* noop */ }
  try {
    await env.RATE_KV.get("__probe__");
    kvOk = true;
  } catch { /* noop */ }
  const primary = primaryParser(env);
  const fallback: "gemini" | "workers-ai" = primary === "gemini" ? "workers-ai" : "gemini";
  return {
    metaVerifyTokenSet: !!env.META_VERIFY_TOKEN,
    metaAppSecretSet: !!env.META_APP_SECRET,
    metaPageTokenSet: !!env.META_PAGE_TOKEN,
    geminiKeySet: !!env.GEMINI_API_KEY,
    linkSigningSecretSet: !!env.LINK_SIGNING_SECRET,
    userHashSaltSet: !!env.USER_HASH_SALT,
    publicBaseUrl: env.PUBLIC_BASE_URL || "",
    webhookUrl: `${base.replace(/\/$/, "")}/webhook`,
    verifyToken: env.META_VERIFY_TOKEN || "",
    d1Ok,
    kvOk,
    queueBound: !!env.SHARE_QUEUE,
    parserPrimary: primary,
    parserFallback: available(env, fallback) ? fallback : null,
    geminiAvailable: available(env, "gemini"),
    workersAiAvailable: available(env, "workers-ai"),
  };
}

async function testMeta(env: Env): Promise<{ ok: boolean; detail: string }> {
  if (!env.META_PAGE_TOKEN) return { ok: false, detail: "META_PAGE_TOKEN not set" };
  const url = `https://graph.facebook.com/${env.GRAPH_API_VERSION}/me?access_token=${encodeURIComponent(env.META_PAGE_TOKEN)}`;
  try {
    const res = await fetch(url);
    const body = await res.text();
    return { ok: res.ok, detail: `${res.status} ${body.slice(0, 300)}` };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

async function testGemini(env: Env): Promise<{ ok: boolean; detail: string }> {
  if (!env.GEMINI_API_KEY) return { ok: false, detail: "GEMINI_API_KEY not set" };
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
    );
    const body = await res.text();
    return { ok: res.ok, detail: `${res.status} ${body.slice(0, 200)}…` };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

async function testAi(env: Env): Promise<{ ok: boolean; detail: string }> {
  const bind = (env as unknown as { AI?: { run(model: string, input: unknown): Promise<unknown> } }).AI;
  if (!bind) return { ok: false, detail: "AI binding not present — add `[ai] binding = \"AI\"` to wrangler.toml and re-deploy" };
  try {
    const r = await bind.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [{ role: "user", content: "reply with just OK" }],
      max_tokens: 4,
    });
    const text = (r as { response?: string }).response ?? "";
    return { ok: text.length > 0, detail: `response: ${text.slice(0, 80)}` };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

async function testD1(env: Env): Promise<{ ok: boolean; detail: string }> {
  try {
    const r = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM conversions",
    ).first<{ n: number }>();
    return { ok: true, detail: `conversions rows: ${r?.n ?? 0}` };
  } catch (e) {
    return { ok: false, detail: `run schema.sql first? ${e}` };
  }
}

async function testKv(env: Env): Promise<{ ok: boolean; detail: string }> {
  try {
    const k = `probe:${Date.now()}`;
    await env.RATE_KV.put(k, "1", { expirationTtl: 60 });
    const v = await env.RATE_KV.get(k);
    return { ok: v === "1", detail: `wrote+read ${k}` };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

interface Stats {
  totalConversions: number;
  last7d: number;
  outcomeSplit: Array<{ parse_outcome: string; n: number }>;
  quotaHits30d: number;
  activeUsers30d: number;
}

async function stats(env: Env): Promise<Stats> {
  const now = Date.now();
  const week = now - 7 * 24 * 3600 * 1000;
  const month = now - 30 * 24 * 3600 * 1000;
  const total = (await env.DB.prepare("SELECT COUNT(*) AS n FROM conversions").first<{ n: number }>())?.n ?? 0;
  const last7 = (await env.DB.prepare("SELECT COUNT(*) AS n FROM conversions WHERE ts >= ?").bind(week).first<{ n: number }>())?.n ?? 0;
  const split = (await env.DB.prepare(
    "SELECT parse_outcome, COUNT(*) AS n FROM conversions WHERE ts >= ? GROUP BY parse_outcome",
  ).bind(month).all<{ parse_outcome: string; n: number }>()).results ?? [];
  const qHits = (await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM conversions WHERE quota_hit = 1 AND ts >= ?",
  ).bind(month).first<{ n: number }>())?.n ?? 0;
  const active = (await env.DB.prepare(
    "SELECT COUNT(DISTINCT user_hash) AS n FROM conversions WHERE ts >= ?",
  ).bind(month).first<{ n: number }>())?.n ?? 0;
  return {
    totalConversions: total,
    last7d: last7,
    outcomeSplit: split,
    quotaHits30d: qHits,
    activeUsers30d: active,
  };
}

function renderPage(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Setup — IG Share2Calendar</title>
<style>
:root { color-scheme: light dark; --ok:#0a7c2f; --bad:#b1361e; --dim:#888; }
body { max-width: 780px; margin: 2rem auto; padding: 0 1rem;
  font: 15px/1.55 -apple-system, system-ui, sans-serif; }
h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
h2 { margin-top: 2rem; font-size: 1.1rem; border-bottom: 1px solid rgba(127,127,127,.3); padding-bottom: .3rem; }
.grid { display: grid; grid-template-columns: 1fr auto; gap: .5rem 1rem; align-items: center; }
.pill { padding: 2px 8px; border-radius: 999px; font-size: .8rem; }
.pill.ok { background: rgba(10,124,47,.15); color: var(--ok); }
.pill.bad { background: rgba(177,54,30,.15); color: var(--bad); }
.pill.dim { background: rgba(127,127,127,.15); color: var(--dim); }
code, pre { background: rgba(127,127,127,.15); padding: 2px 6px; border-radius: 4px; font: 13px/1.4 ui-monospace, Menlo, monospace; }
pre { padding: .6rem .8rem; overflow-x: auto; }
button { font: inherit; padding: .35rem .7rem; border-radius: 6px; border: 1px solid rgba(127,127,127,.4); background: transparent; cursor: pointer; }
button:hover { background: rgba(127,127,127,.1); }
.row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .35rem 0; }
.detail { color: var(--dim); font: 12.5px/1.4 ui-monospace, Menlo, monospace; margin-top: .25rem; word-break: break-all; }
.step { border-left: 3px solid rgba(127,127,127,.4); padding: .25rem 0 .25rem .8rem; margin: .8rem 0; }
.step.done { border-color: var(--ok); }
.step.pending { border-color: #d29922; }
input.copyable { width: 100%; padding: .4rem; font: 13px/1.4 ui-monospace, Menlo, monospace; }
</style>
</head><body>
<h1>IG Share2Calendar — Setup</h1>
<p class="detail">This page is only visible with a bearer token. Copy values into the Meta App dashboard; nothing here submits data anywhere else.</p>

<h2>1. Bindings</h2>
<div id="bindings">Loading…</div>

<h2>2. Secrets</h2>
<div id="secrets">Loading…</div>
<p class="detail">Set with: <code>npx wrangler secret put NAME</code></p>

<h2>3. Meta webhook</h2>
<div class="step" id="s-meta">
  <p>Paste these into the Instagram product's Webhooks configuration:</p>
  <div class="grid">
    <div>Callback URL</div><input class="copyable" id="webhookUrl" readonly/>
    <div>Verify Token</div><input class="copyable" id="verifyToken" readonly/>
  </div>
  <p class="detail">Subscribe to the <code>messages</code> field. Then click below to verify the Page token can reach Graph.</p>
  <div class="row"><button data-test="meta">Test Page token</button><span id="r-meta" class="pill dim">unknown</span></div>
  <div class="detail" id="d-meta"></div>
</div>

<h2>4. Parsers</h2>
<div class="step" id="s-parser">
  <div id="parser-config">Loading…</div>
  <div class="row"><button data-test="gemini">Test Gemini key</button><span id="r-gemini" class="pill dim">unknown</span></div>
  <div class="detail" id="d-gemini"></div>
  <div class="row"><button data-test="ai">Test Workers AI (Llama)</button><span id="r-ai" class="pill dim">unknown</span></div>
  <div class="detail" id="d-ai"></div>
</div>

<h2>5. Storage</h2>
<div class="step" id="s-storage">
  <div class="row"><button data-test="d1">Test D1</button><span id="r-d1" class="pill dim">unknown</span></div>
  <div class="detail" id="d-d1"></div>
  <div class="row"><button data-test="kv">Test KV</button><span id="r-kv" class="pill dim">unknown</span></div>
  <div class="detail" id="d-kv"></div>
</div>

<h2>6. Live stats</h2>
<pre id="stats">…</pre>

<script>
const q = new URLSearchParams(location.search);
const t = q.get('t');
const H = t ? { authorization: 'Bearer ' + t } : {};

async function j(path) {
  const r = await fetch(path + (t ? '?t=' + encodeURIComponent(t) : ''), { headers: H });
  return r.json();
}
function pill(el, ok) { el.textContent = ok ? 'ok' : 'fail'; el.className = 'pill ' + (ok ? 'ok' : 'bad'); }
function pillSet(el, isSet) { el.textContent = isSet ? 'set' : 'missing'; el.className = 'pill ' + (isSet ? 'ok' : 'bad'); }

async function load() {
  const h = await j('/admin/health');
  const rowsB = [
    ['D1 database', h.d1Ok],
    ['KV namespace', h.kvOk],
    ['Queue producer', h.queueBound],
    ['PUBLIC_BASE_URL', !!h.publicBaseUrl],
  ];
  document.getElementById('bindings').innerHTML = rowsB.map(([k,v]) =>
    '<div class="row"><span>' + k + '</span><span class="pill ' + (v?'ok':'bad') + '">' + (v?'ok':'missing') + '</span></div>'
  ).join('');

  const rowsS = [
    ['META_APP_SECRET', h.metaAppSecretSet],
    ['META_VERIFY_TOKEN', h.metaVerifyTokenSet],
    ['META_PAGE_TOKEN', h.metaPageTokenSet],
    ['GEMINI_API_KEY', h.geminiKeySet],
    ['LINK_SIGNING_SECRET', h.linkSigningSecretSet],
    ['USER_HASH_SALT', h.userHashSaltSet],
  ];
  document.getElementById('secrets').innerHTML = rowsS.map(([k,v]) =>
    '<div class="row"><code>' + k + '</code><span class="pill ' + (v?'ok':'bad') + '">' + (v?'set':'missing') + '</span></div>'
  ).join('');

  document.getElementById('webhookUrl').value = h.webhookUrl;
  document.getElementById('verifyToken').value = h.verifyToken || '(set META_VERIFY_TOKEN first)';

  const fb = h.parserFallback ? h.parserFallback : '(none available)';
  document.getElementById('parser-config').innerHTML =
    '<div class="row"><span>Primary parser</span><code>' + h.parserPrimary + '</code></div>' +
    '<div class="row"><span>Fallback parser</span><code>' + fb + '</code></div>' +
    '<div class="detail">Change with the PARSER_PRIMARY var in wrangler.toml. The other parser is used as fallback automatically when available.</div>';

  const s = await j('/admin/stats');
  document.getElementById('stats').textContent = JSON.stringify(s, null, 2);
}

document.querySelectorAll('button[data-test]').forEach(b => {
  b.addEventListener('click', async () => {
    const kind = b.getAttribute('data-test');
    const rEl = document.getElementById('r-' + kind);
    const dEl = document.getElementById('d-' + kind);
    rEl.textContent = '…'; rEl.className = 'pill dim';
    dEl.textContent = '';
    const res = await j('/admin/test/' + kind);
    pill(rEl, res.ok);
    dEl.textContent = res.detail || '';
  });
});

load().catch(e => document.body.insertAdjacentHTML('beforeend',
  '<pre style="color:#b1361e">' + e + '</pre>'));
</script>
</body></html>`;
}
