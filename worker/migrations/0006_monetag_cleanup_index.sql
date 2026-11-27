CREATE INDEX IF NOT EXISTS idx_monetag_reward_status_created
ON monetag_reward_events(status,created_at);