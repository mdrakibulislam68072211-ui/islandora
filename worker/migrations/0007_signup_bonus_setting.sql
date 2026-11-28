CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(updated_by) REFERENCES admin_users(firebase_uid)
);
INSERT OR IGNORE INTO app_settings(key,value) VALUES('signup_bonus_gems','1000');
