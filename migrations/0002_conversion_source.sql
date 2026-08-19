-- 0002: distinguish DM-share conversions from public comment-mention
-- conversions. Existing rows keep their meaning as DM shares.
ALTER TABLE conversions ADD COLUMN source TEXT NOT NULL DEFAULT 'dm';
CREATE INDEX IF NOT EXISTS idx_conversions_source ON conversions(source);
