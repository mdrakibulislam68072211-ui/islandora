-- Monetag-backed Daily Spin verification linkage.
ALTER TABLE spin_attempts ADD COLUMN monetag_ymid TEXT;
ALTER TABLE monetag_reward_events ADD COLUMN purpose TEXT NOT NULL DEFAULT 'wallet';
ALTER TABLE monetag_reward_events ADD COLUMN spin_attempt_id TEXT;
CREATE INDEX IF NOT EXISTS idx_monetag_reward_events_purpose ON monetag_reward_events(purpose,status);
