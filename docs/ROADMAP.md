# Roadmap

Ordered by leverage, not chronology. Every item here is
**scope-cut on purpose** in the current MVP.

## Now (shipped)

- Share-to-DM: user shares an IG post to the bot, gets a calendar
   link. Core loop.
- Reply-with-correction: `TZ Europe/Berlin`, `at 9pm`, etc.
- Public comment reply on any @-mention: parse the mentioned post
   and drop the calendar link into the comment thread (or a CTA to
   DM if we couldn't parse). This is the virality surface.

## Near (next viral unlocks, both fully compliant with Meta policy)

### Story-mention → DM back

Instagram's `messages` webhook fires when someone @-mentions the
bot in a **Story**. Story mentions are treated as inbound messages,
so they open the 24h DM window — meaning the bot can DM the mentioning
user with the calendar link. This is a natural viral surface for
people who share flyers to their Stories.

- New webhook subscription: same `messages` field, filter for the
   `is_echo=false, message.attachments[].type = story_mention` shape.
- Reuse the existing DM-share pipeline; treat the story mention
   attachment as if it were a share attachment.
- Add `source = "story_mention"` on the conversion row.

### Private reply to comments on the bot's own posts

If the bot's IG account posts (or re-posts) event content, any
commenter on those posts is eligible for a **private reply**: a
one-time DM outside the 24h window, exempt because it's answering
a comment on the bot's own post.

Play: the bot maintains a light feed of aggregated event flyers
(or re-shares). Commenters asking "when?" / "where?" / "add this"
get a private-reply DM with the calendar link.

- New webhook subscription: `comments` field.
- Filter to comments on the bot's own posts (owner check on the
   payload).
- Use the `POST /{comment-id}/private_replies` endpoint (or the
   Send API variant that references a comment ID).
- Add `source = "private_reply"` on the conversion row.

## Later (phase 2 — only if THRESHOLDS.md fires)

- **Ticket-link resolution** via Business Discovery on the post's
   author (bio/website field), with a Linktree-style aggregator
   walk if needed.
- **Affiliate injection** when the resolved ticket link matches a
   known ticketing domain (Eventbrite, Ticketmaster), with real
   commission modeling.
- **Reminders** — only if user feedback specifically asks. Current
   design intentionally offloads that to the calendar app.

## Off-plan (do not build)

- Unsolicited DMs to users who follow the bot but never messaged
   it. Violates Meta's IG messaging policy — automated messages to
   users outside the 24h window (with no exempting mechanism) are
   grounds for app suspension. The mechanisms in the "Near" section
   above are the fully-legal alternatives.
- Simulated follow requests. Meta's IG business API does not
   provide a follow endpoint, and even if it did, following doesn't
   open a DM window.
- A native mobile app. Deferred per the original spec § "Option A".
