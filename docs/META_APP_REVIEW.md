# Meta App Review Checklist — IG Share2Calendar

A step-by-step walkthrough for submitting the Meta app for Instagram
messaging permissions. Every requirement here is either **built** (link
into the codebase) or **manual** (something you do in a Meta console).

**Verify against Meta's current requirements before submitting.** Meta
rewrites the app-review flow every few months; treat the URLs and
button labels below as approximate. What our code implements is
frozen; what Meta asks for shifts.

---

## 0. Prerequisites (before opening developers.facebook.com)

- [ ] Meta developer account.
- [ ] **Business Portfolio** (formerly "Business Manager") — Meta
      requires this for messaging apps.
- [ ] **Instagram Business or Creator account** connected to a
      **Facebook Page** you administer. A personal IG account will
      not work.
- [ ] A valid email address for user-facing support. Uses:
      `eboyle@medicibank.us` in the shipped copy — change in
      `src/pages.ts` if needed.

## 1. Create the Meta app

1. developers.facebook.com → **My Apps → Create App**
2. Use case: **Other**. App type: **Business**.
3. Name it something durable (users see it in DMs). This name is
    hard to change later.
4. Attach it to the Business Portfolio from §0.

## 2. Add the Instagram product

1. In the app dashboard, **Add Product → Instagram**.
2. Under Instagram → **Configuration**, connect the Business Portfolio
    from §0 and the IG Business/Creator account.
3. Under Instagram → **Webhooks**, click **Configure webhooks**.

## 3. Wire the webhook (this is where our `/admin` wizard earns its keep)

1. Deploy the Worker (`npx wrangler deploy`). Set every secret from
    the README's setup block first.
2. Open `https://<your-worker>/admin?t=<ADMIN_TOKEN>`.
3. Copy the two values the wizard shows:
     - **Callback URL** → the Meta webhook's Callback URL field.
     - **Verify Token** → the Meta webhook's Verify Token field.
4. Meta will `GET /webhook?hub.mode=subscribe&hub.verify_token=…`.
    Verified in code at `src/worker.ts` → `verifyHandshake`.
5. Subscribe the app to two webhook fields:
    - **`messages`** — the core share-to-DM flow.
    - **`mentions`** — public comment reply when someone @-tags the bot.

## 4. Permissions to request

The bot only needs one permission for the core loop, and one or two
supporting ones. Meta's naming shifts; the current names as of writing
are:

- **`instagram_business_manage_messages`** — required. Lets the app
   receive share-to-DM events and reply within the 24h window.
   This is the only permission that materially matters.
- **`instagram_business_basic`** — usually required alongside the
   above so the app can read the connected IG account's identity.
- **`instagram_business_manage_comments`** — required for the
   `mentions` flow: the bot needs it to (a) read the mentioned
   media/comment via `mentioned_media` / `mentioned_comment` edges,
   and (b) post a public reply to the comment.

Do **not** request permissions the app does not use (extra
permissions slow review and get denied). No `pages_manage_posts`,
no `instagram_manage_insights`, no `pages_read_user_content`.

## 5. App Review submission

For each permission requested, Meta wants three things. Here's what
to paste for `instagram_business_manage_messages`:

### Use-case description

> IG Share2Calendar is a personal utility that turns Instagram event
> posts into calendar entries. A user shares a post from Instagram
> directly to the bot's DM inbox; the app parses the post's caption
> and image, extracts the event's date, time, timezone, title, and
> location, and replies once — inside Instagram's 24-hour messaging
> window — with an "Add to Google Calendar" link and a downloadable
> `.ics` file. That single reply is the entire interaction. No
> reminders, no follow-up messages, no marketing content, no data
> shared with third parties beyond the model providers strictly
> needed to parse the shared post (Google's Gemini API and, as a
> fallback, Cloudflare Workers AI Llama). Users can send `DELETE MY
> DATA` at any time to erase all associated rows; the app also
> honors Meta's `deauthorize` and `data-deletion` callbacks.

### Screencast (Meta will not approve without one)

Record a ~60-second video that shows, in order:
1. Opening Instagram, opening a real event post.
2. Tapping Share → sending to `@YourBot`.
3. The bot's ack DM ("Got it, one sec…") arriving.
4. The bot's reply with the Google Calendar link.
5. Tapping the link, showing the pre-filled event.
6. The user replying with a correction (e.g. `TZ Europe/Berlin`)
    and the bot re-sending the updated link.
7. Sending `DELETE MY DATA` and receiving the confirmation code.

Meta wants to see the **actual product loop end to end** — not a
mockup. Record on a real phone, not a simulator.

### Verification / testing steps

Give the reviewer a test IG handle to DM. If your reviewer sandbox
needs a token, provide one. Include the deletion command in the
notes so they can clean up.

## 6. Required URLs — every one is served by the deployed Worker

Paste these into the app dashboard's Basic Settings + Data
Handling pages:

| Meta field | URL | Served at |
|---|---|---|
| Privacy Policy URL | `https://<worker>/privacy` | `src/pages.ts` → `privacyPage()` |
| Terms of Service URL | `https://<worker>/terms` | `src/pages.ts` → `termsPage()` |
| App Icon | (upload a 1024×1024 PNG) | not in this repo — add one before submit |
| User Data Deletion → Callback URL | `https://<worker>/data-deletion` | `src/worker.ts` → `handleDataDeletion` |
| User Data Deletion → Instructions URL | `https://<worker>/deletion` | `src/pages.ts` → `deletionInfoPage()` |
| Deauthorize Callback URL | `https://<worker>/deauthorize` | `src/worker.ts` → `handleDeauthorize` |

Both callback handlers verify Meta's `signed_request` HMAC in
`src/lib/signed_request.ts`. Both erase every row associated with
the requesting `user_id` (conversions, quota, deletion receipt) in
a single D1 batch via `src/lib/deletion.ts`.

## 7. Data handling declarations

Meta asks a questionnaire about how the app uses data. Answers that
match what the code actually does:

- **Does the app store user data?** Yes — hashed IG user ID
   (SHA-256 + server salt), conversion metadata, monthly quota
   counter, link-click counter.
- **Does the app share user data with third parties?** Yes,
   listed on the privacy page: the caption text and/or the shared
   image bytes are sent per-request to the parser model (Gemini or
   Workers AI Llama). No user identity is included in those calls.
- **Retention?** 13 months for conversion rows (documented on the
   privacy page); deletion requests remove them immediately.
- **Where is data stored?** Cloudflare D1 (SQLite), KV (rate
   limits + pending state), all inside the Cloudflare edge network.

## 8. Common rejection reasons and where the code already handles them

| Rejection reason | How this repo handles it |
|---|---|
| "Deauthorize callback returns 200 for unsigned request" | We return 401 on missing/invalid `signed_request`. See `handleDeauthorize`. |
| "Data-deletion callback does not return JSON `{url, confirmation_code}`" | We do — `handleDataDeletion` returns exactly that shape. |
| "Privacy policy URL 404s or is a placeholder" | Served inline by the Worker; no external host to lapse. |
| "App requests permissions it doesn't use" | We request only the messaging permissions we actually exercise. |
| "Screencast doesn't show real user flow" | See §5 script — always shoot on a real phone against a real deployed Worker. |
| "App sends unsolicited messages" | We only reply within the 24h RESPONSE window after a share. No marketing, no re-engagement. Rate limit is per-user, enforced by `src/lib/rate.ts`. |
| "No way to delete data" | `DELETE MY DATA` in-DM, `/deletion` info page, and the Meta callback all wipe rows immediately. |

## 9. Pre-submit self-audit

Before hitting **Submit for Review**, walk this checklist against
the live deployment:

- [ ] `curl -sS "$WORKER/healthz"` returns `ok`.
- [ ] `/privacy`, `/terms`, `/deletion` all render (open in a browser).
- [ ] `POST /webhook` with a bad signature returns 401 (not 200).
- [ ] `GET /webhook?hub.mode=subscribe&hub.verify_token=<yours>&hub.challenge=x` returns `x`.
- [ ] `/admin` wizard: every secret shows **set**, every dependency
       test shows **ok**.
- [ ] From your test IG account, share an event post → ack DM arrives
       in < 5s, calendar reply arrives in < 30s.
- [ ] `DELETE MY DATA` in-DM erases and echoes a confirmation code.
- [ ] Weekly cron: manually run via `/admin/digest/run` and confirm
       it stores to KV (and posts to Slack/Discord if configured).

## 10. After approval

- [ ] Switch the app from Development → **Live** in the dashboard.
- [ ] Verify the webhook subscription survives the flip.
- [ ] Watch the first real week's digest; if the volume trigger fires
       (see `THRESHOLDS.md`), open the Phase-2 design doc.

## 11. Notes for future you

- Meta's app-review turnaround varies wildly (24h to 3 weeks).
   Submit early; don't gate a launch date on it.
- If review is denied, the response usually cites a specific
   requirement. Read it against §8 before changing anything.
- The `messages` webhook field can be sub-selected on the Meta side
   without a re-review, so if you later want to also handle
   `message_reactions`, you can add it in the dashboard without
   re-submitting.
