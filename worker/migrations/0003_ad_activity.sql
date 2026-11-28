CREATE TABLE IF NOT EXISTS user_ad_activity (
  firebase_uid TEXT NOT NULL,
  ad_setting_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  opens_today INTEGER NOT NULL DEFAULT 0 CHECK (opens_today >= 0),
  last_opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(firebase_uid,ad_setting_id),
  FOREIGN KEY(firebase_uid) REFERENCES users(firebase_uid),
  FOREIGN KEY(ad_setting_id) REFERENCES ad_settings(id)
);
CREATE INDEX IF NOT EXISTS idx_user_ad_activity_day
ON user_ad_activity(firebase_uid,day_key);
CREATE TABLE IF NOT EXISTS monetag_reward_events (
  ymid TEXT PRIMARY KEY,
  firebase_uid TEXT NOT NULL,
  reward_coins INTEGER NOT NULL CHECK (reward_coins >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','credited','ignored')),
  event_type TEXT,
  reward_event_type TEXT,
  estimated_price TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  credited_at TEXT,
  FOREIGN KEY(firebase_uid) REFERENCES users(firebase_uid)
);
