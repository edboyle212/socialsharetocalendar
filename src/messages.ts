// User-facing DM strings. One place to tweak copy.

export const M = {
  ack: "Got it, one sec — pulling the details…",

  // Comment-mention replies. These land in a public IG comment thread,
  // so they need to be short and self-explanatory. No emoji-only lines
  // — some feeds render them poorly.
  commentLink: (username: string | undefined, when: string, gcal: string) =>
    `${username ? "@" + username + " " : ""}📅 ${when}\nAdd to Google Calendar: ${gcal}`,
  commentCta: (username: string | undefined) =>
    `${username ? "@" + username + " " : ""}DM me this post and I'll send you a calendar link 📅`,

  success: (title: string, when: string, gcal: string, ics: string) =>
    `📅 ${title}\n${when}\n\nAdd to Google Calendar:\n${gcal}\n\nOr download .ics:\n${ics}`,
  updated: (fields: string, gcal: string, ics: string) =>
    `Updated 👇\n${fields}\n\nAdd to Google Calendar:\n${gcal}\n\nOr download .ics:\n${ics}\n\nReply CANCEL if you're done.`,
  partial: (fields: string, gcal: string, ics: string) =>
    `Couldn't read all the details — here's what I got:\n${fields}\n\nAdd to Google Calendar:\n${gcal}\n\nOr download .ics:\n${ics}\n\nIf a field is wrong, reply with the correction (e.g. "TZ Europe/Berlin" or a corrected date) and re-share.`,
  notAnEvent:
    "This doesn't look like an event post — no date I could read. If you think I'm wrong, reply with the date and I'll try again.",
  parseFailed:
    "Sorry — couldn't read the event details from this one. Common causes: caption has no date, or the flyer text isn't legible.",
  quotaHit: (cap: number) =>
    `You've hit the free monthly limit of ${cap} events. Resets on the 1st. (More coming soon — reply UPGRADE to be notified.)`,
  privatePost:
    "I can't fetch this post — it may be private or from an account that hasn't authorized the bot.",
  genericError:
    "Something went wrong on my side. Try sharing the post again in a minute.",
};
