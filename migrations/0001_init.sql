-- 0001_init: full schema at first commit.
--
-- Apply with: wrangler d1 migrations apply ig_share2calendar --remote
-- (or --local for the dev sandbox). Wrangler tracks applied migrations
-- in the internal d1_migrations table; do not run this file with
-- `d1 execute` on a database that already has applied migrations.

CREATE TABLE IF NOT EXISTS conversions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  user_hash TEXT NOT NULL,
  permalink TEXT,
  parse_outcome TEXT NOT NULL,        -- 'caption' | 'vision' | 'failed' | 'correction'
  confidence REAL,
  latency_ms INTEGER,
  quota_hit INTEGER NOT NULL DEFAULT 0,
  model TEXT
);
CREATE INDEX IF NOT EXISTS idx_conversions_user_ts ON conversions(user_hash, ts);
CREATE INDEX IF NOT EXISTS idx_conversions_ts ON conversions(ts);

CREATE TABLE IF NOT EXISTS quota (
  user_hash TEXT NOT NULL,
  yyyymm TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_hash, yyyymm)
);

CREATE TABLE IF NOT EXISTS link_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  conversion_id INTEGER,
  kind TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_link_clicks_conversion ON link_clicks(conversion_id);

CREATE TABLE IF NOT EXISTS seen_messages (
  key TEXT PRIMARY KEY,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_seen_ts ON seen_messages(ts);

CREATE TABLE IF NOT EXISTS dlq_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  user_hash TEXT,
  sender_id TEXT,
  received_at INTEGER,
  attachment_url TEXT,
  notified_user INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_dlq_ts ON dlq_events(ts);

CREATE TABLE IF NOT EXISTS deletion_requests (
  code TEXT PRIMARY KEY,
  user_hash TEXT NOT NULL,
  ts INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed'
);
