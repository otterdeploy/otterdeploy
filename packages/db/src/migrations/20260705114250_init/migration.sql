CREATE TYPE "audit_actor_type" AS ENUM('user', 'system', 'api', 'agent');--> statement-breakpoint
CREATE TYPE "audit_outcome" AS ENUM('success', 'failure', 'denied');--> statement-breakpoint
CREATE TYPE "backup_destination_status" AS ENUM('active', 'degraded');--> statement-breakpoint
CREATE TYPE "backup_destination_type" AS ENUM('s3', 'local', 'sftp');--> statement-breakpoint
CREATE TYPE "backup_encryption" AS ENUM('none', 'aes-256-gcm', 'kms-managed', 'customer-key');--> statement-breakpoint
CREATE TYPE "backup_kind" AS ENUM('database', 'volume', 'stack');--> statement-breakpoint
CREATE TYPE "backup_log_stream" AS ENUM('stdout', 'stderr', 'system');--> statement-breakpoint
CREATE TYPE "backup_retention_class" AS ENUM('short', 'standard', 'long', 'archive');--> statement-breakpoint
CREATE TYPE "backup_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "branch_strategy" AS ENUM('zfs', 'copy');--> statement-breakpoint
CREATE TYPE "compose_source" AS ENUM('inline', 'git');--> statement-breakpoint
CREATE TYPE "container_registry_auth" AS ENUM('password', 'token');--> statement-breakpoint
CREATE TYPE "database_engine" AS ENUM('postgres', 'redis', 'mariadb', 'mongodb', 'clickhouse', 'rabbitmq', 'minio', 'meilisearch');--> statement-breakpoint
CREATE TYPE "deployment_log_stream" AS ENUM('stdout', 'stderr', 'system');--> statement-breakpoint
CREATE TYPE "deployment_reason" AS ENUM('create', 'redeploy', 'env-change', 'image-change', 'restart', 'git-push', 'rollback');--> statement-breakpoint
CREATE TYPE "deployment_status" AS ENUM('pending', 'building', 'running', 'failed', 'superseded', 'removed');--> statement-breakpoint
CREATE TYPE "environment_kind" AS ENUM('persistent', 'preview');--> statement-breakpoint
CREATE TYPE "environment_state" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "git_installation_account_type" AS ENUM('user', 'organization');--> statement-breakpoint
CREATE TYPE "git_installation_repo_selection" AS ENUM('all', 'selected');--> statement-breakpoint
CREATE TYPE "git_provider_kind" AS ENUM('github');--> statement-breakpoint
CREATE TYPE "notification_channel" AS ENUM('in-app', 'push', 'sms');--> statement-breakpoint
CREATE TYPE "notification_channel_kind" AS ENUM('slack', 'discord', 'email', 'webhook', 'telegram', 'pagerduty', 'push');--> statement-breakpoint
CREATE TYPE "notification_channel_status" AS ENUM('active', 'paused', 'disconnected');--> statement-breakpoint
CREATE TYPE "notification_delivery_status" AS ENUM('delivered', 'failed');--> statement-breakpoint
CREATE TYPE "project_status" AS ENUM('draft', 'valid', 'invalid');--> statement-breakpoint
CREATE TYPE "proxy_route_cert_state" AS ENUM('unknown', 'obtaining', 'valid', 'failed');--> statement-breakpoint
CREATE TYPE "proxy_route_dns_state" AS ENUM('pointed', 'proxied', 'unpointed', 'unknown');--> statement-breakpoint
CREATE TYPE "proxy_route_protocol" AS ENUM('tcp', 'http');--> statement-breakpoint
CREATE TYPE "proxy_route_source" AS ENUM('generated', 'custom');--> statement-breakpoint
CREATE TYPE "proxy_route_type" AS ENUM('http', 'layer4');--> statement-breakpoint
CREATE TYPE "resource_status" AS ENUM('draft', 'valid', 'invalid');--> statement-breakpoint
CREATE TYPE "resource_type" AS ENUM('database', 'service', 'compose');--> statement-breakpoint
CREATE TYPE "server_availability" AS ENUM('active', 'drain', 'pause');--> statement-breakpoint
CREATE TYPE "server_role" AS ENUM('manager', 'worker');--> statement-breakpoint
CREATE TYPE "server_status" AS ENUM('ready', 'draining', 'down');--> statement-breakpoint
CREATE TYPE "service_app_protocol" AS ENUM('http', 'tcp');--> statement-breakpoint
CREATE TYPE "service_mount_type" AS ENUM('volume', 'bind', 'file');--> statement-breakpoint
CREATE TYPE "service_port_protocol" AS ENUM('tcp', 'udp');--> statement-breakpoint
CREATE TYPE "service_restart_condition" AS ENUM('none', 'on-failure', 'any');--> statement-breakpoint
CREATE TYPE "service_source" AS ENUM('image', 'git');--> statement-breakpoint
CREATE TYPE "ssh_key_type" AS ENUM('ed25519', 'rsa', 'ecdsa');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" text PRIMARY KEY,
	"config_id" text NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"reference_id" text NOT NULL,
	"key" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_time_window" integer,
	"rate_limit_max" integer,
	"request_count" integer DEFAULT 0 NOT NULL,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY,
	"organization_id" text,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" text NOT NULL,
	"actor_email" text,
	"actor_label" text,
	"target_type" text,
	"target_id" text,
	"target" jsonb,
	"outcome" "audit_outcome" NOT NULL,
	"reason" text,
	"duration_ms" integer,
	"changes" jsonb,
	"request_id" text,
	"trace_id" text,
	"ip" text,
	"user_agent" text,
	"correlation_id" text,
	"causation_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"schedule_id" text,
	"kind" "backup_kind" DEFAULT 'database'::"backup_kind" NOT NULL,
	"status" "backup_status" DEFAULT 'queued'::"backup_status" NOT NULL,
	"method" text,
	"destination_id" text NOT NULL,
	"encryption" "backup_encryption" DEFAULT 'aes-256-gcm'::"backup_encryption" NOT NULL,
	"source_size_bytes" bigint,
	"compressed_size_bytes" bigint,
	"checksum" text,
	"storage_path" text,
	"retention" "backup_retention_class" DEFAULT 'standard'::"backup_retention_class" NOT NULL,
	"duration_ms" integer,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_destination" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "backup_destination_type" NOT NULL,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"encrypted_secret" text,
	"status" "backup_destination_status" DEFAULT 'active'::"backup_destination_status" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_log" (
	"seq" bigserial PRIMARY KEY,
	"backup_id" text NOT NULL,
	"stream" "backup_log_stream" NOT NULL,
	"line" text NOT NULL,
	"ts" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_schedule" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"sources" jsonb DEFAULT '[]' NOT NULL,
	"cron" text NOT NULL,
	"keep_daily" integer DEFAULT 0 NOT NULL,
	"keep_weekly" integer DEFAULT 0 NOT NULL,
	"keep_monthly" integer DEFAULT 0 NOT NULL,
	"keep_yearly" integer DEFAULT 0 NOT NULL,
	"retention_days" integer,
	"max_storage_gb" integer,
	"destination_ids" jsonb DEFAULT '[]' NOT NULL,
	"encryption" "backup_encryption" DEFAULT 'aes-256-gcm'::"backup_encryption" NOT NULL,
	"pitr" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"pre_hook" text,
	"notify_channel" text,
	"last_run_at" timestamp,
	"last_run_status" "backup_status",
	"next_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocklist" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"catalog_slug" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"duration_hours" integer DEFAULT 24 NOT NULL,
	"interval_minutes" integer DEFAULT 360 NOT NULL,
	"last_synced_at" timestamp,
	"last_status" text,
	"last_error" text,
	"last_count" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compose_resource" (
	"resource_id" text PRIMARY KEY,
	"source" "compose_source" DEFAULT 'inline'::"compose_source" NOT NULL,
	"compose_content" text,
	"git_repo_url" text,
	"git_ref" text,
	"source_subdir" text,
	"compose_path" text,
	"stack_name" text NOT NULL,
	"services" jsonb DEFAULT '[]' NOT NULL,
	"built_images" jsonb DEFAULT '{}' NOT NULL,
	"exposed" jsonb DEFAULT '[]' NOT NULL,
	"force_update_counter" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "container_registry" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"display_name" text NOT NULL,
	"host" text NOT NULL,
	"username" text NOT NULL,
	"encrypted_password" text NOT NULL,
	"auth_type" "container_registry_auth" DEFAULT 'password'::"container_registry_auth" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "database_draft_credential" (
	"project_id" text,
	"name" text,
	"password" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "database_draft_credential_pkey" PRIMARY KEY("project_id","name")
);
--> statement-breakpoint
CREATE TABLE "database_resource" (
	"resource_id" text PRIMARY KEY,
	"engine" "database_engine" DEFAULT 'postgres'::"database_engine" NOT NULL,
	"database_name" text NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"public_enabled" boolean DEFAULT false NOT NULL,
	"public_hostname" text NOT NULL,
	"public_port" integer DEFAULT 443 NOT NULL,
	"public_connection_string" text NOT NULL,
	"internal_hostname" text NOT NULL,
	"internal_port" integer DEFAULT 5432 NOT NULL,
	"internal_connection_string" text NOT NULL,
	"upstream_host" text NOT NULL,
	"upstream_port" integer DEFAULT 5432 NOT NULL,
	"caddy_layer4_snippet" text NOT NULL,
	"engine_config" jsonb DEFAULT '{}' NOT NULL,
	"extra_env" jsonb DEFAULT '{}' NOT NULL,
	"secret_keys" jsonb DEFAULT '[]' NOT NULL,
	"extensions" jsonb DEFAULT '[]' NOT NULL,
	"branch_strategy" "branch_strategy",
	"branch_snapshot_ref" text,
	"legacy_volume_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment" (
	"id" text PRIMARY KEY,
	"resource_id" text NOT NULL,
	"environment_id" text,
	"image" text NOT NULL,
	"reason" "deployment_reason" DEFAULT 'create'::"deployment_reason" NOT NULL,
	"status" "deployment_status" DEFAULT 'pending'::"deployment_status" NOT NULL,
	"snapshot" jsonb DEFAULT '{}' NOT NULL,
	"git_sha" text,
	"git_ref" text,
	"git_commit_message" text,
	"git_commit_author" text,
	"error_message" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_guest" (
	"id" text PRIMARY KEY,
	"proxy_route_id" text NOT NULL,
	"email" text NOT NULL,
	"session_hours" integer DEFAULT 24 NOT NULL,
	"invited_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_log" (
	"seq" bigserial PRIMARY KEY,
	"deployment_id" text NOT NULL,
	"stream" "deployment_log_stream" NOT NULL,
	"line" text NOT NULL,
	"ts" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_code" (
	"id" text PRIMARY KEY,
	"device_code" text NOT NULL UNIQUE,
	"user_code" text NOT NULL UNIQUE,
	"user_id" text,
	"client_id" text,
	"scope" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"last_polled_at" timestamp,
	"polling_interval" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edge_event" (
	"id" bigserial PRIMARY KEY,
	"ts" timestamp with time zone NOT NULL,
	"level" text NOT NULL,
	"category" text NOT NULL,
	"logger" text NOT NULL,
	"msg" text NOT NULL,
	"host" text,
	"domains" jsonb DEFAULT '[]' NOT NULL,
	"upstream" text,
	"error" text,
	"raw" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environment" (
	"id" text PRIMARY KEY,
	"project_id" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" "environment_kind" DEFAULT 'persistent'::"environment_kind" NOT NULL,
	"state" "environment_state" DEFAULT 'active'::"environment_state" NOT NULL,
	"base_environment_id" text,
	"git_repo_id" text,
	"git_ref" text,
	"pull_request_number" integer,
	"pull_request_node_id" text,
	"head_sha" text,
	"auto_teardown_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_installation" (
	"id" text PRIMARY KEY,
	"provider_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_type" "git_installation_account_type" NOT NULL,
	"account_avatar_url" text,
	"repo_selection" "git_installation_repo_selection" NOT NULL,
	"permissions" jsonb DEFAULT '{}' NOT NULL,
	"suspended_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_provider" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"kind" "git_provider_kind" NOT NULL,
	"display_name" text NOT NULL,
	"host" text DEFAULT 'github.com' NOT NULL,
	"external_app_id" text,
	"app_slug" text,
	"client_id" text,
	"client_secret_ciphertext" text,
	"webhook_secret_ciphertext" text,
	"private_key_pem_ciphertext" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_repo" (
	"id" text PRIMARY KEY,
	"installation_id" text,
	"provider_repo_id" text NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"is_private" boolean DEFAULT true NOT NULL,
	"clone_url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"team_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"inviter_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"organization_id" text,
	"channel" "notification_channel" DEFAULT 'in-app'::"notification_channel" NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channel_config" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"kind" "notification_channel_kind" NOT NULL,
	"name" text NOT NULL,
	"target" text NOT NULL,
	"transport" text NOT NULL,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"encrypted_secret" text,
	"status" "notification_channel_status" DEFAULT 'active'::"notification_channel_status" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_delivery" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"event_id" text NOT NULL,
	"status" "notification_delivery_status" NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_subscription" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"event_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"logo" text,
	"metadata" text,
	"base_domain" text,
	"base_domain_verified_at" timestamp,
	"base_domain_verify_token" text,
	"cloudflare_api_token" text,
	"cloudflare_zone_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_metric" (
	"seq" bigserial PRIMARY KEY,
	"ts" timestamp DEFAULT now() NOT NULL,
	"metric" text NOT NULL,
	"value" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" text PRIMARY KEY DEFAULT 'platform',
	"control_plane_fqdn" text,
	"server_ip" text,
	"acme_email" text,
	"https_auto_redirect" boolean,
	"email_provider" text,
	"email_from" text,
	"resend_api_key_ciphertext" text,
	"smtp_host" text,
	"smtp_port" integer,
	"smtp_secure" boolean,
	"smtp_user" text,
	"smtp_password_ciphertext" text,
	"update_channel" text DEFAULT 'stable',
	"auto_update_enabled" boolean DEFAULT false,
	"last_update_checked_at" timestamp,
	"available_version" text,
	"available_release_notes" text,
	"available_release_url" text,
	"dismissed_version" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"environment_id" text,
	"stack_file" text,
	"stack_file_version" integer DEFAULT 0 NOT NULL,
	"last_applied_file" text,
	"last_applied_at" timestamp,
	"manifest" jsonb,
	"manifest_version" integer DEFAULT 0 NOT NULL,
	"last_applied_manifest" jsonb,
	"last_manifest_applied_at" timestamp,
	"custom_domain" text,
	"custom_domain_verified_at" timestamp,
	"custom_domain_verify_token" text,
	"custom_caddy_config" text,
	"nixpacks_config" jsonb DEFAULT 'null',
	"graph_layout" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_env_subscription" (
	"id" text PRIMARY KEY,
	"service_resource_id" text NOT NULL,
	"project_env_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_env_var" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"is_secret" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proxy_route" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"resource_id" text,
	"type" "proxy_route_type" NOT NULL,
	"domain" text NOT NULL,
	"upstream_host" text NOT NULL,
	"upstream_port" integer NOT NULL,
	"protocol" "proxy_route_protocol" NOT NULL,
	"layer4_alpn" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"source" "proxy_route_source" DEFAULT 'generated'::"proxy_route_source" NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"dns_state" "proxy_route_dns_state" DEFAULT 'unknown'::"proxy_route_dns_state" NOT NULL,
	"dns_checked_at" timestamp,
	"cert_state" "proxy_route_cert_state" DEFAULT 'unknown'::"proxy_route_cert_state" NOT NULL,
	"cert_error" text,
	"cert_checked_at" timestamp,
	"uses_acme" boolean DEFAULT false NOT NULL,
	"protected" boolean DEFAULT false NOT NULL,
	"custom_directives" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "resource_type" NOT NULL,
	"status" "resource_status" DEFAULT 'draft'::"resource_status" NOT NULL,
	"environment_id" text,
	"branched_from_resource_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_metric" (
	"seq" bigserial PRIMARY KEY,
	"resource_id" text NOT NULL,
	"container_id" text NOT NULL,
	"ts" timestamp DEFAULT now() NOT NULL,
	"cpu_pct" double precision NOT NULL,
	"mem_bytes" bigint NOT NULL,
	"mem_limit_bytes" bigint NOT NULL,
	"net_rx_bytes" bigint DEFAULT 0 NOT NULL,
	"net_tx_bytes" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"hostname" text,
	"host" text NOT NULL,
	"region" text,
	"role" "server_role" DEFAULT 'worker'::"server_role" NOT NULL,
	"status" "server_status" DEFAULT 'ready'::"server_status" NOT NULL,
	"availability" "server_availability" DEFAULT 'active'::"server_availability" NOT NULL,
	"cpu_total" integer NOT NULL,
	"mem_total_gb" integer NOT NULL,
	"disk_total_gb" integer,
	"disk_unit" text DEFAULT 'GB' NOT NULL,
	"daemon_version" text,
	"labels" jsonb DEFAULT '[]' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_env_var" (
	"id" text PRIMARY KEY,
	"service_resource_id" text NOT NULL,
	"environment_id" text,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"is_secret" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_mount" (
	"id" text PRIMARY KEY,
	"service_resource_id" text NOT NULL,
	"type" "service_mount_type" NOT NULL,
	"target" text NOT NULL,
	"source" text,
	"content" text,
	"read_only" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_port" (
	"id" text PRIMARY KEY,
	"service_resource_id" text NOT NULL,
	"container_port" integer NOT NULL,
	"protocol" "service_port_protocol" DEFAULT 'tcp'::"service_port_protocol" NOT NULL,
	"app_protocol" "service_app_protocol" DEFAULT 'http'::"service_app_protocol" NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_resource" (
	"resource_id" text PRIMARY KEY,
	"image" text NOT NULL,
	"image_digest" text,
	"command" text[],
	"entrypoint" text[],
	"source" "service_source" DEFAULT 'image'::"service_source" NOT NULL,
	"source_subdir" text,
	"framework" text,
	"replicas" integer DEFAULT 1 NOT NULL,
	"restart_condition" "service_restart_condition" DEFAULT 'on-failure'::"service_restart_condition" NOT NULL,
	"restart_max_attempts" integer,
	"restart_delay_ms" integer DEFAULT 5000 NOT NULL,
	"restart_window_ms" integer,
	"healthcheck_cmd" text[],
	"healthcheck_interval_ms" integer,
	"healthcheck_timeout_ms" integer,
	"healthcheck_retries" integer,
	"healthcheck_start_ms" integer,
	"cpu_limit" numeric(4,2),
	"memory_limit_mb" integer,
	"cpu_reservation" numeric(4,2),
	"memory_reservation_mb" integer,
	"disk_limit_mb" integer,
	"swap_limit_mb" integer,
	"pids_limit" integer,
	"pre_deploy" text[],
	"post_deploy" text[],
	"build_config" jsonb,
	"git_repo_id" text,
	"branch" text,
	"image_repository" text,
	"internal_hostname" text NOT NULL,
	"service_name" text NOT NULL,
	"network_name" text NOT NULL,
	"public_enabled" boolean DEFAULT false NOT NULL,
	"public_domain" text,
	"stack_id" text,
	"force_update_counter" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"active_organization_id" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ssh_key" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "ssh_key_type" NOT NULL,
	"bits" integer,
	"public_key" text NOT NULL,
	"private_key_ciphertext" text,
	"fingerprint" text NOT NULL,
	"comment" text,
	"imported" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_member" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_referenceId_idx" ON "apikey" ("reference_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" ("key");--> statement-breakpoint
CREATE INDEX "audit_log_org_ts_idx" ON "audit_log" ("organization_id","timestamp");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" ("action");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_log_outcome_idx" ON "audit_log" ("outcome");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_log_correlation_idx" ON "audit_log" ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_idempotency_key_idx" ON "audit_log" ("idempotency_key");--> statement-breakpoint
CREATE INDEX "backup_org_idx" ON "backup" ("organization_id");--> statement-breakpoint
CREATE INDEX "backup_resource_idx" ON "backup" ("resource_id");--> statement-breakpoint
CREATE INDEX "backup_schedule_idx" ON "backup" ("schedule_id");--> statement-breakpoint
CREATE INDEX "backup_status_idx" ON "backup" ("status");--> statement-breakpoint
CREATE INDEX "backup_destination_org_idx" ON "backup_destination" ("organization_id");--> statement-breakpoint
CREATE INDEX "backup_log_backup_seq_idx" ON "backup_log" ("backup_id","seq");--> statement-breakpoint
CREATE INDEX "backup_schedule_org_idx" ON "backup_schedule" ("organization_id");--> statement-breakpoint
CREATE INDEX "backup_schedule_next_run_idx" ON "backup_schedule" ("enabled","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "blocklist_url_unique" ON "blocklist" ("url");--> statement-breakpoint
CREATE INDEX "blocklist_enabled_idx" ON "blocklist" ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "compose_resource_stack_name_unique" ON "compose_resource" ("stack_name");--> statement-breakpoint
CREATE INDEX "container_registry_org_idx" ON "container_registry" ("organization_id");--> statement-breakpoint
CREATE INDEX "container_registry_host_idx" ON "container_registry" ("host");--> statement-breakpoint
CREATE UNIQUE INDEX "container_registry_org_host_user_uq" ON "container_registry" ("organization_id","host","username");--> statement-breakpoint
CREATE INDEX "database_resource_database_name_idx" ON "database_resource" ("database_name");--> statement-breakpoint
CREATE INDEX "database_resource_username_idx" ON "database_resource" ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "database_resource_public_hostname_unique" ON "database_resource" ("public_hostname");--> statement-breakpoint
CREATE UNIQUE INDEX "database_resource_internal_hostname_unique" ON "database_resource" ("internal_hostname");--> statement-breakpoint
CREATE INDEX "deployment_resource_id_idx" ON "deployment" ("resource_id");--> statement-breakpoint
CREATE INDEX "deployment_resource_created_idx" ON "deployment" ("resource_id","created_at");--> statement-breakpoint
CREATE INDEX "deployment_environment_id_idx" ON "deployment" ("environment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_guest_route_email_unique" ON "deployment_guest" ("proxy_route_id","email");--> statement-breakpoint
CREATE INDEX "deployment_guest_route_idx" ON "deployment_guest" ("proxy_route_id");--> statement-breakpoint
CREATE INDEX "deployment_log_deployment_seq_idx" ON "deployment_log" ("deployment_id","seq");--> statement-breakpoint
CREATE INDEX "device_code_user_code_idx" ON "device_code" ("user_code");--> statement-breakpoint
CREATE INDEX "device_code_device_code_idx" ON "device_code" ("device_code");--> statement-breakpoint
CREATE INDEX "edge_event_ts_idx" ON "edge_event" ("ts");--> statement-breakpoint
CREATE INDEX "environment_project_id_idx" ON "environment" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "environment_project_slug_unique" ON "environment" ("project_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "environment_project_repo_pr_unique" ON "environment" ("project_id","git_repo_id","pull_request_number");--> statement-breakpoint
CREATE UNIQUE INDEX "git_installation_installation_id_unique" ON "git_installation" ("installation_id");--> statement-breakpoint
CREATE INDEX "git_installation_provider_id_idx" ON "git_installation" ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "git_provider_org_kind_unique" ON "git_provider" ("organization_id","kind");--> statement-breakpoint
CREATE INDEX "git_provider_organization_id_idx" ON "git_provider" ("organization_id");--> statement-breakpoint
CREATE INDEX "git_provider_external_app_id_idx" ON "git_provider" ("external_app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "git_repo_provider_repo_id_unique" ON "git_repo" ("provider_repo_id");--> statement-breakpoint
CREATE INDEX "git_repo_installation_id_idx" ON "git_repo" ("installation_id");--> statement-breakpoint
CREATE INDEX "git_repo_full_name_idx" ON "git_repo" ("full_name");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" ("organization_id");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" ("user_id");--> statement-breakpoint
CREATE INDEX "notification_user_created_idx" ON "notification" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_user_unread_idx" ON "notification" ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "notification_channel_org_idx" ON "notification_channel_config" ("organization_id");--> statement-breakpoint
CREATE INDEX "notification_delivery_channel_created_idx" ON "notification_delivery" ("channel_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_subscription_channel_event_idx" ON "notification_subscription" ("channel_id","event_id");--> statement-breakpoint
CREATE INDEX "notification_subscription_org_event_idx" ON "notification_subscription" ("organization_id","event_id");--> statement-breakpoint
CREATE INDEX "platform_metric_metric_ts_idx" ON "platform_metric" ("metric","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "project_org_slug_unique" ON "project" ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "project_organization_id_idx" ON "project" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_env_subscription_unique" ON "project_env_subscription" ("service_resource_id","project_env_key");--> statement-breakpoint
CREATE INDEX "project_env_subscription_service_resource_id_idx" ON "project_env_subscription" ("service_resource_id");--> statement-breakpoint
CREATE INDEX "project_env_subscription_key_idx" ON "project_env_subscription" ("project_env_key");--> statement-breakpoint
CREATE UNIQUE INDEX "project_env_var_unique" ON "project_env_var" ("project_id","environment_id","key");--> statement-breakpoint
CREATE INDEX "project_env_var_project_id_idx" ON "project_env_var" ("project_id");--> statement-breakpoint
CREATE INDEX "project_env_var_environment_id_idx" ON "project_env_var" ("environment_id");--> statement-breakpoint
CREATE INDEX "project_env_var_key_idx" ON "project_env_var" ("project_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "proxy_route_domain_unique" ON "proxy_route" ("domain");--> statement-breakpoint
CREATE INDEX "proxy_route_project_id_idx" ON "proxy_route" ("project_id");--> statement-breakpoint
CREATE INDEX "proxy_route_resource_id_idx" ON "proxy_route" ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_project_name_base_unique" ON "resource" ("project_id","name") WHERE environment_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_project_name_env_unique" ON "resource" ("project_id","environment_id","name") WHERE environment_id is not null;--> statement-breakpoint
CREATE INDEX "resource_project_id_idx" ON "resource" ("project_id");--> statement-breakpoint
CREATE INDEX "resource_environment_id_idx" ON "resource" ("environment_id");--> statement-breakpoint
CREATE INDEX "resource_metric_resource_ts_idx" ON "resource_metric" ("resource_id","ts");--> statement-breakpoint
CREATE INDEX "server_organization_id_idx" ON "server" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "server_org_host_unique" ON "server" ("organization_id","host");--> statement-breakpoint
CREATE UNIQUE INDEX "service_env_var_unique" ON "service_env_var" ("service_resource_id","key");--> statement-breakpoint
CREATE INDEX "service_env_var_service_resource_id_idx" ON "service_env_var" ("service_resource_id");--> statement-breakpoint
CREATE INDEX "service_env_var_environment_id_idx" ON "service_env_var" ("environment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_mount_target_unique" ON "service_mount" ("service_resource_id","target");--> statement-breakpoint
CREATE INDEX "service_mount_service_resource_id_idx" ON "service_mount" ("service_resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_port_unique" ON "service_port" ("service_resource_id","container_port","protocol");--> statement-breakpoint
CREATE INDEX "service_port_service_resource_id_idx" ON "service_port" ("service_resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_resource_service_name_unique" ON "service_resource" ("service_name");--> statement-breakpoint
CREATE INDEX "service_resource_stack_id_idx" ON "service_resource" ("stack_id");--> statement-breakpoint
CREATE INDEX "service_resource_git_repo_branch_idx" ON "service_resource" ("git_repo_id","branch");--> statement-breakpoint
CREATE UNIQUE INDEX "service_resource_network_hostname_unique" ON "service_resource" ("network_name","internal_hostname");--> statement-breakpoint
CREATE UNIQUE INDEX "service_resource_public_domain_unique" ON "service_resource" ("public_domain");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "ssh_key_organization_id_idx" ON "ssh_key" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ssh_key_org_fingerprint_unique" ON "ssh_key" ("organization_id","fingerprint");--> statement-breakpoint
CREATE INDEX "team_member_team_id_idx" ON "team_member" ("team_id");--> statement-breakpoint
CREATE INDEX "team_member_user_id_idx" ON "team_member" ("user_id");--> statement-breakpoint
CREATE INDEX "two_factor_userId_idx" ON "two_factor" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "backup" ADD CONSTRAINT "backup_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "backup" ADD CONSTRAINT "backup_resource_id_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resource"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "backup" ADD CONSTRAINT "backup_schedule_id_backup_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "backup_schedule"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "backup" ADD CONSTRAINT "backup_destination_id_backup_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "backup_destination"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "backup_destination" ADD CONSTRAINT "backup_destination_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "backup_log" ADD CONSTRAINT "backup_log_backup_id_backup_id_fkey" FOREIGN KEY ("backup_id") REFERENCES "backup"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "backup_schedule" ADD CONSTRAINT "backup_schedule_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "backup_schedule" ADD CONSTRAINT "backup_schedule_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "compose_resource" ADD CONSTRAINT "compose_resource_resource_id_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resource"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "container_registry" ADD CONSTRAINT "container_registry_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "database_draft_credential" ADD CONSTRAINT "database_draft_credential_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "database_resource" ADD CONSTRAINT "database_resource_resource_id_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resource"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_resource_id_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resource"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "deployment_guest" ADD CONSTRAINT "deployment_guest_proxy_route_id_proxy_route_id_fkey" FOREIGN KEY ("proxy_route_id") REFERENCES "proxy_route"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "deployment_log" ADD CONSTRAINT "deployment_log_deployment_id_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployment"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "environment" ADD CONSTRAINT "environment_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "git_installation" ADD CONSTRAINT "git_installation_provider_id_git_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "git_provider"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "git_provider" ADD CONSTRAINT "git_provider_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "git_repo" ADD CONSTRAINT "git_repo_installation_id_git_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "git_installation"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_channel_config" ADD CONSTRAINT "notification_channel_config_R5fvJl17cNWW_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_Dahvx2gLkpyT_fkey" FOREIGN KEY ("channel_id") REFERENCES "notification_channel_config"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_subscription" ADD CONSTRAINT "notification_subscription_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_subscription" ADD CONSTRAINT "notification_subscription_F4UwH10RgwmQ_fkey" FOREIGN KEY ("channel_id") REFERENCES "notification_channel_config"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_env_subscription" ADD CONSTRAINT "project_env_subscription_zeM2Xa5RcnzI_fkey" FOREIGN KEY ("service_resource_id") REFERENCES "service_resource"("resource_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_env_var" ADD CONSTRAINT "project_env_var_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_env_var" ADD CONSTRAINT "project_env_var_environment_id_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environment"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "proxy_route" ADD CONSTRAINT "proxy_route_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "server" ADD CONSTRAINT "server_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "service_env_var" ADD CONSTRAINT "service_env_var_36wfKaBoKcpa_fkey" FOREIGN KEY ("service_resource_id") REFERENCES "service_resource"("resource_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "service_env_var" ADD CONSTRAINT "service_env_var_environment_id_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environment"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "service_mount" ADD CONSTRAINT "service_mount_LpRmwM5PzFgO_fkey" FOREIGN KEY ("service_resource_id") REFERENCES "service_resource"("resource_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "service_port" ADD CONSTRAINT "service_port_5AojKFt3I4LO_fkey" FOREIGN KEY ("service_resource_id") REFERENCES "service_resource"("resource_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "service_resource" ADD CONSTRAINT "service_resource_resource_id_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resource"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "service_resource" ADD CONSTRAINT "service_resource_stack_id_compose_resource_resource_id_fkey" FOREIGN KEY ("stack_id") REFERENCES "compose_resource"("resource_id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ssh_key" ADD CONSTRAINT "ssh_key_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_team_id_project_id_fkey" FOREIGN KEY ("team_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;