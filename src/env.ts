export interface Env {
  DB: D1Database;
  RATE_KV: KVNamespace;
  SHARE_QUEUE: Queue<ShareJob>;
  MENTION_QUEUE: Queue<MentionJob>;

  GRAPH_API_VERSION: string;
  QUOTA_MONTHLY_CAP: string;
  PARSE_CONFIDENCE_THRESHOLD: string;

  META_APP_SECRET: string;
  META_VERIFY_TOKEN: string;
  META_PAGE_TOKEN: string;
  GEMINI_API_KEY: string;
  LINK_SIGNING_SECRET: string;
  USER_HASH_SALT: string;
  PUBLIC_BASE_URL: string;
  ADMIN_TOKEN?: string;
  PARSER_PRIMARY?: string;    // "gemini" (default) | "workers-ai"
  AI?: unknown;               // Cloudflare Workers AI binding, when configured
  DIGEST_WEBHOOK_URL?: string; // Slack/Discord-shaped incoming webhook for digests
}

export interface ShareJob {
  sender_id: string;
  attachment_url?: string;
  attachment_payload_id?: string;
  received_at: number;
}

export interface MentionJob {
  ig_user_id: string;
  media_id: string;
  comment_id?: string;
  received_at: number;
}
