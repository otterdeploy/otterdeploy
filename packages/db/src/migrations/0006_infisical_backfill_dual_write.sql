-- 0006_infisical_backfill_dual_write.sql
-- Phase 2: backfill existing secret-bearing rows into provider references.
-- This script is intentionally conservative and designed to be run with app-level backfill tooling.

-- 1) Create provider bindings for any orgs that do not already have one.
-- NOTE: provider_project_id/provider_project_slug should be created by managed gateway.
-- Placeholder only:
-- INSERT INTO secret_provider_binding (...) VALUES (...) ON CONFLICT (...) DO NOTHING;

-- 2) Backfill environment variables that do not yet have secret_reference_id.
-- Placeholder only:
-- SELECT id, organization_id, scope, scope_id, key, encrypted_value
-- FROM environment_variable
-- WHERE secret_reference_id IS NULL;

-- 3) Backfill ssh keys that do not yet have private_key_secret_reference_id.
-- Placeholder only:
-- SELECT id, organization_id, encrypted_private_key
-- FROM ssh_key
-- WHERE private_key_secret_reference_id IS NULL;

-- 4) Backfill git provider secrets where legacy encrypted columns still exist.
-- Placeholder only:
-- SELECT id, organization_id, encrypted_client_secret, encrypted_webhook_secret
-- FROM git_provider
-- WHERE client_secret_reference_id IS NULL OR webhook_secret_reference_id IS NULL;

-- 5) Dual-write verification checks.
-- These checks should be zero before cutover:
-- SELECT count(*) FROM environment_variable WHERE secret_reference_id IS NULL;
-- SELECT count(*) FROM ssh_key WHERE private_key_secret_reference_id IS NULL;
-- SELECT count(*) FROM git_provider
--   WHERE encrypted_client_secret IS NOT NULL AND client_secret_reference_id IS NULL;
-- SELECT count(*) FROM git_provider
--   WHERE encrypted_webhook_secret IS NOT NULL AND webhook_secret_reference_id IS NULL;
