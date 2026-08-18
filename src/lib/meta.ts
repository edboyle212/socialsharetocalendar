import type { Env } from "../env.js";

const GRAPH = (env: Env) => `https://graph.facebook.com/${env.GRAPH_API_VERSION}`;

export interface IncomingMessage {
  sender_id: string;
  mid?: string;
  text?: string;
  attachments: Array<{ type: string; payload: { url?: string; id?: string } }>;
}

export interface IGWebhookBody {
  object?: string;
  entry?: Array<{
    messaging?: Array<{
      sender?: { id?: string };
      message?: {
        mid?: string;
        text?: string;
        attachments?: Array<{ type?: string; payload?: { url?: string; id?: string } }>;
      };
    }>;
  }>;
}

export function extractShareMessages(body: IGWebhookBody): IncomingMessage[] {
  const out: IncomingMessage[] = [];
  for (const entry of body.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      const sender = m.sender?.id;
      if (!sender) continue;
      const atts = m.message?.attachments ?? [];
      const shareLike = atts
        .filter((a) => a && (a.type === "share" || a.type === "ig_reel" || a.type === "story_mention" || a.type === "image"))
        .map((a) => ({ type: a.type ?? "share", payload: { url: a.payload?.url, id: a.payload?.id } }));
      const text = m.message?.text;
      if (shareLike.length > 0 || text) {
        out.push({ sender_id: sender, mid: m.message?.mid, text, attachments: shareLike });
      }
    }
  }
  return out;
}

export async function sendDM(env: Env, recipientId: string, text: string): Promise<void> {
  const url = `${GRAPH(env)}/me/messages?access_token=${encodeURIComponent(env.META_PAGE_TOKEN)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: { text },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`sendDM failed ${res.status}: ${err}`);
  }
}

export interface FetchedPost {
  caption?: string;
  permalink?: string;
  media_url?: string;
  username?: string;
  media_type?: string;
}

// The webhook share attachment gives us a media URL, not always an ig media id.
// Best-effort: if we have a URL, use it as the image; otherwise fetch by id.
export async function fetchPost(env: Env, attachment: { url?: string; id?: string }): Promise<FetchedPost> {
  if (attachment.id) {
    const fields = "caption,permalink,media_url,media_type,username";
    const url = `${GRAPH(env)}/${encodeURIComponent(attachment.id)}?fields=${fields}&access_token=${encodeURIComponent(env.META_PAGE_TOKEN)}`;
    const res = await fetch(url);
    if (res.ok) {
      const j = (await res.json()) as FetchedPost;
      if (j.media_url || j.caption) return j;
    }
  }
  return { media_url: attachment.url };
}

export async function downloadMedia(url: string): Promise<{ bytes: ArrayBuffer; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`downloadMedia ${res.status}`);
  const mime = res.headers.get("content-type") ?? "image/jpeg";
  return { bytes: await res.arrayBuffer(), mime };
}
