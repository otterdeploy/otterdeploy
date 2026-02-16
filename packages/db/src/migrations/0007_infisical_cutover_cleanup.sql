-- 0007_infisical_cutover_cleanup.sql
-- Phase 3: cutover to reference-only reads/writes and remove legacy columns.

-- Precondition checks (must be zero before execution):
-- SELECT count(*) FROM environment_variable WHERE secret_reference_id IS NULL;
-- SELECT count(*) FROM ssh_key WHERE private_key_secret_reference_id IS NULL;
-- SELECT count(*) FROM git_provider
--   WHERE encrypted_client_secret IS NOT NULL AND client_secret_reference_id IS NULL;
-- SELECT count(*) FROM git_provider
--   WHERE encrypted_webhook_secret IS NOT NULL AND webhook_secret_reference_id IS NULL;

-- Enforce non-null references once backfill is complete.
-- ALTER TABLE environment_variable ALTER COLUMN secret_reference_id SET NOT NULL;
-- ALTER TABLE ssh_key ALTER COLUMN private_key_secret_reference_id SET NOT NULL;

-- Remove legacy dual-write columns after successful cutover window.
-- ALTER TABLE environment_variable DROP COLUMN encrypted_value;
-- ALTER TABLE ssh_key DROP COLUMN encrypted_private_key;
-- ALTER TABLE git_provider DROP COLUMN encrypted_client_secret;
-- ALTER TABLE git_provider DROP COLUMN encrypted_webhook_secret;
