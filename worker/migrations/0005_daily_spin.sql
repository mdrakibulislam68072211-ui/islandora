CREATE TABLE IF NOT EXISTS spin_settings (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
 daily_limit INTEGER NOT NULL DEFAULT 1 CHECK (daily_limit = 1),
 updated_by TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(updated_by) REFERENCES admin_users(firebase_uid)
);
INSERT OR IGNORE INTO spin_settings(id,enabled,daily_limit) VALUES(1,1,1);
CREATE TABLE IF NOT EXISTS spin_reward_options (
 id TEXT PRIMARY KEY,
 reward_coins INTEGER NOT NULL CHECK (reward_coins > 0),
 probability_bps INTEGER NOT NULL CHECK (probability_bps >= 0 AND probability_bps <= 10000),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
 sort_order INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO spin_reward_options(id,reward_coins,probability_bps,enabled,sort_order) VALUES
 ('spin-20',20,3500,1,1),
 ('spin-30',30,2500,1,2),
 ('spin-50',50,1500,1,3),
 ('spin-75',75,1000,1,4),
 ('spin-100',100,700,1,5),
 ('spin-150',150,400,1,6),
 ('spin-200',200,200,1,7),
 ('spin-300',300,150,1,8),
 ('spin-500',500,50,1,9);
CREATE TABLE IF NOT EXISTS spin_attempts (
 id TEXT PRIMARY KEY,
 firebase_uid TEXT NOT NULL,
 day_key TEXT NOT NULL,
 reward_coins INTEGER NOT NULL CHECK (reward_coins > 0),
 status TEXT NOT NULL DEFAULT 'locked' CHECK (status IN ('locked','verified','claimed')),
 adsterra_psid TEXT NOT NULL UNIQUE,
 idempotency_key TEXT NOT NULL UNIQUE,
 ad_opened_at TEXT,
 verified_at TEXT,
 claimed_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(firebase_uid,day_key),
 FOREIGN KEY(firebase_uid) REFERENCES users(firebase_uid)
);
CREATE INDEX IF NOT EXISTS idx_spin_attempts_status ON spin_attempts(status,created_at);
