-- Islandora game backend schema guard migration (staging first).
-- Existing production tables are expected to be present.
-- This migration only adds indexes; it does not modify user balances.
CREATE INDEX IF NOT EXISTS idx_user_islands_user_unlocked
  ON user_islands(firebase_uid, is_unlocked, island_number);
CREATE INDEX IF NOT EXISTS idx_user_island_boxes_user_island
  ON user_island_boxes(firebase_uid, island_number, box_number);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_created
  ON wallet_transactions(firebase_uid, created_at);
CREATE INDEX IF NOT EXISTS idx_referrals_referred_valid
  ON referrals(referred_uid, is_valid);
