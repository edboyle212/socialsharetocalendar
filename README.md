# ig-share2calendar

Instagram → calendar link bot. User shares an IG post to the bot's DMs;
the server parses the post and replies with an "Add to Google Calendar"
link and a `.ics` download. One share in, one reply out — nothing else.

See `IGshare2calendarbuildspecmvp.md` (in the original upload) for the
product spec. Phase-2 gating lives in `THRESHOLDS.md`.

## Layout

```
src/
  worker.ts          fetch + queue entrypoints (webhook, ICS, redirect, consumer)
  env.ts             typed bindings (D1, KV, Queue) + ShareJob
  messages.ts        user-facing DM copy in one place
  lib/
    meta.ts          Meta Graph API: signature-safe webhook parse, sendDM, fetchPost
    parse.ts         Gemini text → vision cascade with structured JSON output
    calendar.ts      GCal URL builder, .ics builder, HMAC-signed link tokens
    crypto.ts        HMAC + SHA-256 helpers (Web Crypto)
    quota.ts         per-user monthly conversion cap
    log.ts           D1 conversion + click writes
    rate.ts          per-user fixed-window rate limit (KV)
test/                vitest unit tests for calendar, crypto, meta parsing
schema.sql           D1 tables
wrangler.toml        one Worker, one Queue producer + consumer
```

## Setup

```sh
npm install
npx wrangler d1 create ig_share2calendar          # copy id into wrangler.toml
npx wrangler kv namespace create RATE_KV          # copy id into wrangler.toml
npx wrangler queues create share-events
npx wrangler queues create share-events-dlq
npx wrangler d1 execute ig_share2calendar --file=schema.sql --remote

# Secrets:
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_VERIFY_TOKEN
npx wrangler secret put META_PAGE_TOKEN
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put LINK_SIGNING_SECRET
npx wrangler secret put USER_HASH_SALT
npx wrangler secret put PUBLIC_BASE_URL       # e.g. https://ig-share2calendar.workers.dev
npx wrangler secret put ADMIN_TOKEN           # any high-entropy string; gates /admin
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

## Deferred, on purpose

Reminders, ticket-link resolution via Business Discovery, affiliate
injection, and any mobile-app work. See §8/§9 of the spec.
