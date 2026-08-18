-- D1 schema for IG Share2Calendar MVP.
-- Apply with: wrangler d1 execute ig_share2calendar --file=schema.sql

CREATE TABLE IF NOT EXISTS conversions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,                 -- epoch ms
  user_hash TEXT NOT NULL,             -- sha256(sender_id + salt)
  permalink TEXT,
  parse_outcome TEXT NOT NULL,         -- 'caption' | 'vision' | 'failed'
  confidence REAL,
  latency_ms INTEGER,
  quota_hit INTEGER NOT NULL DEFAULT 0,
  model TEXT                           -- which provider resolved this (e.g. 'gemini/gemini-1.5-flash-latest')
);
-- If migrating an existing deploy: ALTER TABLE conversions ADD COLUMN model TEXT;
CREATE INDEX IF NOT EXISTS idx_conversions_user_ts ON conversions(user_hash, ts);
CREATE INDEX IF NOT EXISTS idx_conversions_ts ON conversions(ts);

CREATE TABLE IF NOT EXISTS quota (
  user_hash TEXT NOT NULL,
  yyyymm TEXT NOT NULL,                -- e.g. '202608'
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_hash, yyyymm)
);

CREATE TABLE IF NOT EXISTS link_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  conversion_id INTEGER,
  kind TEXT NOT NULL                   -- 'gcal' | 'ics'
);
CREATE INDEX IF NOT EXISTS idx_link_clicks_conversion ON link_clicks(conversion_id);

-- Idempotency: Meta retries webhooks. Dedupe by (sender_id, message_mid).
CREATE TABLE IF NOT EXISTS seen_messages (
  key TEXT PRIMARY KEY,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_seen_ts ON seen_messages(ts);

-- Deletion-request receipts, for Meta compliance and audit.
CREATE TABLE IF NOT EXISTS deletion_requests (
  code TEXT PRIMARY KEY,
  user_hash TEXT NOT NULL,
  ts INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed'
);
