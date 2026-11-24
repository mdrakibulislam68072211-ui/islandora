-- Review-only migration for the Islandora signup bonus.
-- Apply only after reviewing and explicitly approving production deployment.
-- The trigger writes the Gems ledger row atomically with creation of a new user.
CREATE TRIGGER IF NOT EXISTS users_signup_bonus_ledger
AFTER INSERT ON users
WHEN NEW.signup_bonus_granted = 1 AND NEW.gems = 1000
BEGIN
  INSERT INTO wallet_transactions (
    id,
    firebase_uid,
    currency,
    amount,
    transaction_type,
    description,
    reference_id,
    idempotency_key
  )
  VALUES (
    lower(hex(randomblob(16))),
    NEW.firebase_uid,
    'Gems',
    1000,
    'signup_bonus',
    'One-time signup bonus',
    NEW.firebase_uid,
    'signup_bonus:' || NEW.firebase_uid
  );
END;
