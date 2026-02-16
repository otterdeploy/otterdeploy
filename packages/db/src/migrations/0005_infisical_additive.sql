-- 0005_infisical_additive.sql
-- Phase 1: additive schema for Infisical-first rollout (no destructive changes).

DO $$
BEGIN
  CREATE TYPE secret_provider AS ENUM ('infisical', 'native_breakglass');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE secret_kind AS ENUM ('env_var', 'ssh_private_key', 'git_client_secret', 'git_webhook_secret');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE secret_logical_scope AS ENUM ('organization', 'project', 'environment', 'resource');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE secret_provider_binding_status AS ENUM ('provisioning', 'active', 'error');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS secret_provider_binding (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  provider secret_provider NOT NULL DEFAULT 'infisical',
  provider_project_id text NOT NULL,
  provider_project_slug text NOT NULL,
  status secret_provider_binding_status NOT NULL DEFAULT 'provisioning',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS secret_provider_binding_org_uidx
  ON secret_provider_binding (organization_id);

CREATE TABLE IF NOT EXISTS secret_reference (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  provider secret_provider NOT NULL,
  kind secret_kind NOT NULL,
  logical_scope secret_logical_scope NOT NULL,
  logical_scope_id text NOT NULL,
  key text NOT NULL,
  provider_path text NOT NULL,
  provider_key text NOT NULL,
  provider_version text NULL,
  last_resolved_at timestamp NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS secret_reference_scope_key_uidx
  ON secret_reference (organization_id, kind, logical_scope, logical_scope_id, key);

CREATE TABLE IF NOT EXISTS deployment_secret_snapshot (
  id text PRIMARY KEY,
  deployment_id text NOT NULL REFERENCES deployment(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  resource_id text NOT NULL REFERENCES project_resource(id) ON DELETE CASCADE,
  entries_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapshot_hash text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS deployment_secret_snapshot_deployment_uidx
  ON deployment_secret_snapshot (deployment_id);

ALTER TABLE environment_variable
  ADD COLUMN IF NOT EXISTS secret_reference_id text NULL REFERENCES secret_reference(id) ON DELETE SET NULL;

ALTER TABLE ssh_key
  ADD COLUMN IF NOT EXISTS private_key_secret_reference_id text NULL REFERENCES secret_reference(id) ON DELETE SET NULL;

ALTER TABLE git_provider
  ADD COLUMN IF NOT EXISTS client_secret_reference_id text NULL REFERENCES secret_reference(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS webhook_secret_reference_id text NULL REFERENCES secret_reference(id) ON DELETE SET NULL;
