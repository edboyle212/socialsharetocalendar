export interface Env {
  DB: D1Database;
  RATE_KV: KVNamespace;
  SHARE_QUEUE: Queue<ShareJob>;

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
}

export interface ShareJob {
  sender_id: string;
  attachment_url?: string;
  attachment_payload_id?: string;
  received_at: number;
}
