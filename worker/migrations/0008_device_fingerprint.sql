-- Store only a one-way hash of coarse browser/device characteristics.
-- Raw fingerprint components are never persisted.
ALTER TABLE user_devices ADD COLUMN device_fingerprint_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_user_devices_fingerprint
ON user_devices(device_fingerprint_hash);