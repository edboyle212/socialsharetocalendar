# ig-share2calendar

[![ci](https://github.com/edboyle212/socialsharetocalendar/actions/workflows/ci.yml/badge.svg)](https://github.com/edboyle212/socialsharetocalendar/actions/workflows/ci.yml)

Instagram → calendar link bot. User shares an IG post to the bot's DMs;
the server parses the post and replies with an "Add to Google Calendar"
link and a `.ics` download. One share in, one reply out — nothing else.

See `IGshare2calendarbuildspecmvp.md` (in the original upload) for the
product spec. Phase-2 gating lives in `THRESHOLDS.md`. Meta app-review
submission is walked through in `docs/META_APP_REVIEW.md`.

## Layout

```
src/
  worker.ts          fetch + queue entrypoints (webhook, ICS, redirect, consumer)
  env.ts             typed bindings (D1, KV, Queue, AI) + ShareJob
  messages.ts        user-facing DM copy in one place
  lib/
    meta.ts          Meta Graph API: signature-safe webhook parse, sendDM, fetchPost
    parsers/         pluggable parser cascade
      types.ts       Parser interface + shared prompt + defensive JSON extract
      gemini.ts      Gemini 1.5 Flash text+vision (native structured output)
      workers_ai.ts  Llama 3.2 Vision via the Cloudflare AI binding
      index.ts       primary/fallback orchestrator; tags result with `model`
    calendar.ts      GCal URL builder, .ics builder, HMAC-signed link tokens
    tz.ts            naive-local → real-UTC via Intl (two-pass, DST-safe)
    crypto.ts        HMAC + SHA-256 helpers (Web Crypto)
    quota.ts         per-user monthly conversion cap
    log.ts           D1 conversion + click writes
    rate.ts          per-user fixed-window rate limit (KV)
    idempotency.ts   dedupe on (sender_id, mid)
    deletion.ts      erase all rows for a user, return confirmation code
    signed_request.ts Meta signed_request HMAC verifier
  admin.ts           /admin bearer-token wizard (secrets, tests, stats)
  pages.ts           /privacy, /terms, /deletion static pages
test/                vitest unit tests
migrations/          numbered .sql migrations (wrangler d1 tracks applied ones)
wrangler.toml        Worker + queue + D1 + KV + AI bindings
```

## Setup

```sh
npm install
npx wrangler d1 create ig_share2calendar          # copy id into wrangler.toml
npx wrangler kv namespace create RATE_KV          # copy id into wrangler.toml
npx wrangler queues create share-events
npx wrangler queues create share-events-dlq
npx wrangler d1 migrations apply ig_share2calendar --remote

# Secrets:
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_VERIFY_TOKEN
npx wrangler secret put META_PAGE_TOKEN
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put LINK_SIGNING_SECRET
npx wrangler secret put USER_HASH_SALT
npx wrangler secret put PUBLIC_BASE_URL       # e.g. https://ig-share2calendar.workers.dev
npx wrangler secret put ADMIN_TOKEN           # any high-entropy string; gates /admin
npx wrangler secret put DIGEST_WEBHOOK_URL    # optional Slack/Discord webhook for weekly digest
```

## Admin wizard

After deploying, open `https://<your-worker>/admin?t=<ADMIN_TOKEN>` to
see a one-page setup wizard: which secrets are set, live D1/KV/Gemini
tests, the exact webhook URL and verify token to paste into the Meta
dashboard, and live conversion stats. The page is bearer-token gated
and calls only your own worker.

## Local dev

```sh
npm run typecheck
npm test
npx wrangler dev
```

## Webhook contract

- `GET  /webhook` — Meta verification handshake (`hub.challenge`).
- `POST /webhook` — Meta events. Signature verified via
  `X-Hub-Signature-256`. Ack is fire-and-forget via `ctx.waitUntil`
  so we always return 200 in <1s. Duplicate `mid` values are dropped.
- `GET  /ics/:token` — stateless `.ics` download; token is HMAC-signed.
- `GET  /r/:token` — 302 redirect to Google Calendar; logs a click.
- `POST /deauthorize` — Meta callback when a user removes the app;
  erases their rows on receipt.
- `POST /data-deletion` — Meta data-deletion callback; erases rows
  and returns `{url, confirmation_code}` JSON per Meta's spec.
- `GET  /privacy`, `/terms`, `/deletion` — required static pages.
- `GET  /admin` — setup wizard (bearer-token gated).

## Instrumentation

Every job writes one row to `conversions`. Successful links route
through `/r/` and `/ics/` so `link_clicks` records which link the
user tapped. Query examples:

```sql
-- weekly conversions
SELECT date(ts/1000, 'unixepoch', 'weekday 0', '-6 days') AS week_start,
       COUNT(*) FROM conversions WHERE parse_outcome != 'failed' GROUP BY 1;

-- quota pressure
SELECT yyyymm, COUNT(*) FROM quota WHERE count >= 5 GROUP BY yyyymm;
```

## In-DM commands and corrections

Beyond sharing a post, a user can send plain-text messages:

- **Correction** — after any share, replying with something like
  `TZ Europe/Berlin`, `at 9pm`, `on Sep 20`, `at Roulette Intermedium`
  routes to the refine path: the LLM merges the correction with the
  pending event and the bot re-sends updated calendar links. Pending
  state lives in KV for 1 hour under `pending:<user_hash>`.
- **`CANCEL`** — drops pending state.
- **`DELETE MY DATA`** — erases every row associated with the user.

Corrections are logged with `parse_outcome = 'correction'` so they
show up separately in analytics.

## D1 migrations

Schema changes live in `migrations/` as numbered files
(`0001_init.sql`, `0002_something.sql`, …). Wrangler's D1 tooling
records the applied set in a hidden `d1_migrations` table so re-runs
are safe.

To add a migration:

```sh
npx wrangler d1 migrations create ig_share2calendar add_something
# edits an empty NNNN_add_something.sql — write SQL there
npx wrangler d1 migrations apply ig_share2calendar --local   # sandbox
npx wrangler d1 migrations apply ig_share2calendar --remote  # prod
```

Rules of thumb:

- Every schema change (new table, new column, index, `ALTER`) is a
  new file — never edit an already-applied migration.
- Prefer additive changes. Drops or column removals are irreversible
  in D1's forward-only model; back-fill or dual-write first.
- The current app expects the schema at `0001_init.sql`. Older
  deployments with no `d1_migrations` table should be treated as
  fresh installs — apply from `0001` on a new database.

## Weekly digest and Phase-2 gating

Cron in `wrangler.toml` fires the `scheduled` handler every Monday at
14:00 UTC. It runs `buildDigest(env)` — 7d volumes, 30d model split,
quota pressure, weekly history, and evaluates the Phase-2 triggers
from `THRESHOLDS.md`. Delivery is:

1. `POST` to `DIGEST_WEBHOOK_URL` if set (Slack/Discord shape:
   `{ text, digest }`), and
2. Stored to KV under `digest:last` for 8 weeks — the admin wizard
   shows it, and the "Run digest now" button re-runs it on demand.

Dead-letter jobs (three retries exhausted) go through a second queue
consumer that logs to `dlq_events` and, when still inside the IG 24h
messaging window, sends the user an apology DM.

## Model choice

The parser is pluggable. Two implementations ship:

- **`gemini`** — Gemini 1.5 Flash via the public API. Best OCR/vision
  accuracy on flyer-style images and native structured-JSON output.
  Requires `GEMINI_API_KEY`. **Default primary.**
- **`workers-ai`** — Llama 3.2 11B Vision via the Cloudflare AI
  binding. In-Worker, zero egress, no key management. Weaker on
  dense flyer text but a clean fallback when Gemini rate-limits.

Change the primary with `PARSER_PRIMARY = "workers-ai"` in
`wrangler.toml`. The other parser is automatically used as fallback
if its dependencies are available. Every `conversions` row records
which model produced the result, so accuracy can be A/B'd from data.

## Deferred, on purpose

Reminders, ticket-link resolution via Business Discovery, affiliate
injection, and any mobile-app work. See §8/§9 of the spec.
