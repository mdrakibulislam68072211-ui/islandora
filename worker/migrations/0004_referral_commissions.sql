CREATE TABLE IF NOT EXISTS referral_commission_ledger (
 id TEXT PRIMARY KEY,
 referrer_uid TEXT NOT NULL,
 referred_uid TEXT NOT NULL,
 source_transaction_id TEXT NOT NULL UNIQUE,
 spent_gems INTEGER NOT NULL CHECK(spent_gems > 0),
 commission_milli_coins INTEGER NOT NULL CHECK(commission_milli_coins > 0),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(referrer_uid) REFERENCES users(firebase_uid),
 FOREIGN KEY(referred_uid) REFERENCES users(firebase_uid),
 FOREIGN KEY(source_transaction_id) REFERENCES wallet_transactions(id)
);
CREATE INDEX IF NOT EXISTS idx_referral_commission_referrer
 ON referral_commission_ledger(referrer_uid,created_at);
CREATE TABLE IF NOT EXISTS referral_commission_claims (
 id TEXT PRIMARY KEY,
 referrer_uid TEXT NOT NULL,
 commission_milli_coins INTEGER NOT NULL CHECK(commission_milli_coins >= 5000),
 coins_claimed INTEGER NOT NULL CHECK(coins_claimed >= 5),
 idempotency_key TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(referrer_uid) REFERENCES users(firebase_uid)
);
CREATE INDEX IF NOT EXISTS idx_referral_claims_referrer
 ON referral_commission_claims(referrer_uid,created_at);