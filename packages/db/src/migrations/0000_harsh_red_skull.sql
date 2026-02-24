CREATE TYPE "public"."backup_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."builder" AS ENUM('nixpacks', 'dockerfile', 'buildpack', 'railpack');--> statement-breakpoint
CREATE TYPE "public"."caddy_status" AS ENUM('not_installed', 'initializing', 'running', 'stopped', 'error');--> statement-breakpoint
CREATE TYPE "public"."database_type" AS ENUM('postgresql', 'mysql', 'mariadb', 'mongodb', 'redis', 'keydb', 'dragonfly', 'clickhouse');--> statement-breakpoint
CREATE TYPE "public"."deployment_source" AS ENUM('git_push', 'manual', 'rollback', 'api', 'preview', 'config_change');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('queued', 'building', 'deploying', 'verifying', 'live', 'failed', 'canceled', 'rolled_back');--> statement-breakpoint
CREATE TYPE "public"."resource_kind" AS ENUM('web', 'api', 'worker', 'database', 'compose');--> statement-breakpoint
CREATE TYPE "public"."resource_status" AS ENUM('online', 'degraded', 'crashed', 'deploying', 'stopped', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."restart_policy" AS ENUM('ON_FAILURE', 'ALWAYS', 'NEVER');--> statement-breakpoint
CREATE TYPE "public"."secret_kind" AS ENUM('env_var', 'ssh_private_key', 'git_client_secret', 'git_webhook_secret');--> statement-breakpoint
CREATE TYPE "public"."secret_logical_scope" AS ENUM('organization', 'project', 'environment', 'resource');--> statement-breakpoint
CREATE TYPE "public"."secret_provider_binding_status" AS ENUM('provisioning', 'active', 'error');--> statement-breakpoint
CREATE TYPE "public"."secret_provider" AS ENUM('infisical', 'native_breakglass');--> statement-breakpoint
CREATE TYPE "public"."server_role" AS ENUM('manager', 'worker');--> statement-breakpoint
CREATE TYPE "public"."server_status" AS ENUM('connected', 'disconnected', 'provisioning', 'error');--> statement-breakpoint
CREATE TYPE "public"."ssl_status" AS ENUM('pending', 'active', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
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
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"user_id" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"rate_limit_max" integer DEFAULT 10,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "device_code" (
	"id" text PRIMARY KEY NOT NULL,
	"device_code" text NOT NULL,
	"user_code" text NOT NULL,
	"user_id" text,
	"expires_at" timestamp NOT NULL,
	"status" text NOT NULL,
	"last_polled_at" timestamp,
	"polling_interval" integer,
	"client_id" text,
	"scope" text
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp,
	"two_factor_enabled" boolean DEFAULT false,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"status" "deployment_status" DEFAULT 'queued' NOT NULL,
	"source" "deployment_source" DEFAULT 'manual' NOT NULL,
	"git_ref" text,
	"git_commit_sha" text,
	"git_commit_message" text,
	"builder" "builder",
	"image_tag" text,
	"previous_image_tag" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"duration" integer,
	"triggered_by" text,
	"idempotency_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_event" (
	"id" text PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"status" "deployment_status" NOT NULL,
	"previous_status" "deployment_status",
	"actor" text,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environment" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"base_domain" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"server_id" text,
	"kind" "resource_kind" NOT NULL,
	"name" text NOT NULL,
	"status" "resource_status" DEFAULT 'unknown' NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_position" (
	"resource_id" text PRIMARY KEY NOT NULL,
	"pos_x" double precision DEFAULT 0 NOT NULL,
	"pos_y" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "viewport" (
	"environment_id" text PRIMARY KEY NOT NULL,
	"x" double precision DEFAULT 0 NOT NULL,
	"y" double precision DEFAULT 0 NOT NULL,
	"zoom" double precision DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "database_config" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"database_type" "database_type" NOT NULL,
	"image" text NOT NULL,
	"database_name" text,
	"database_user" text,
	"external_port" integer,
	"custom_config" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "database_config_resource_id_unique" UNIQUE("resource_id")
);
--> statement-breakpoint
CREATE TABLE "resource_build_config" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"registry_id" text,
	"builder" "builder",
	"dockerfile_path" text DEFAULT 'Dockerfile',
	"build_command" text,
	"watch_patterns" text[],
	"root_directory" text DEFAULT '/',
	"pre_deploy_command" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "resource_build_config_resource_id_unique" UNIQUE("resource_id")
);
--> statement-breakpoint
CREATE TABLE "resource_compose_config" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"compose_file" text NOT NULL,
	"compose_path" text DEFAULT 'docker-compose.yml',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "resource_compose_config_resource_id_unique" UNIQUE("resource_id")
);
--> statement-breakpoint
CREATE TABLE "resource_job_config" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"cron_schedule" text NOT NULL,
	"cron_command" text NOT NULL,
	"overlap_seconds" integer,
	"draining_seconds" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "resource_job_config_resource_id_unique" UNIQUE("resource_id")
);
--> statement-breakpoint
CREATE TABLE "resource_runtime_config" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"port" integer,
	"start_command" text,
	"restart_policy" "restart_policy",
	"restart_policy_max_retries" integer,
	"replicas" integer DEFAULT 1,
	"cpu_limit" real,
	"memory_limit" integer,
	"region" text,
	"sleep_application" boolean DEFAULT false,
	"health_check_path" text,
	"health_check_interval" integer DEFAULT 30,
	"health_check_timeout" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "resource_runtime_config_resource_id_unique" UNIQUE("resource_id")
);
--> statement-breakpoint
CREATE TABLE "resource_volume" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"driver" text DEFAULT 'local',
	"size_gb" integer,
	"storage_class" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_volume_mount" (
	"id" text PRIMARY KEY NOT NULL,
	"volume_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"mount_path" text NOT NULL,
	"read_only" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"app_id" text,
	"client_id" text,
	"client_secret_reference_id" text,
	"installation_id" text,
	"webhook_secret_reference_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_repository" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"git_provider_id" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"branch" text DEFAULT 'main' NOT NULL,
	"root_directory" text DEFAULT '/',
	"auto_deploy" boolean DEFAULT true NOT NULL,
	"webhook_id" text,
	"watch_paths" text[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"ip_address" text NOT NULL,
	"port" integer DEFAULT 22 NOT NULL,
	"ssh_key_id" text,
	"status" "server_status" DEFAULT 'disconnected' NOT NULL,
	"role" "server_role" DEFAULT 'worker' NOT NULL,
	"docker_version" text,
	"os" text,
	"arch" text,
	"total_memory" bigint,
	"total_cpu" integer,
	"total_disk" bigint,
	"swarm_node_id" text,
	"base_domain" text,
	"docker_cleanup_threshold" integer DEFAULT 80,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ssh_key" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"public_key" text NOT NULL,
	"private_key_secret_reference_id" text,
	"fingerprint" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"user_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"type" text NOT NULL,
	"status" "backup_status" DEFAULT 'pending' NOT NULL,
	"storage_key" text,
	"size" bigint,
	"checksum" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"expires_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_domain" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"domain" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"verification_token" text,
	"ssl_status" "ssl_status" DEFAULT 'pending' NOT NULL,
	"ssl_expires_at" timestamp,
	"redirect_rules" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environment_variable" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"environment_id" text,
	"resource_id" text,
	"key" text NOT NULL,
	"secret_reference_id" text,
	"encrypted_value" text NOT NULL,
	"is_build_time" boolean DEFAULT false NOT NULL,
	"is_secret" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "env_var_exactly_one_scope" CHECK ((
        (project_id IS NOT NULL)::int +
        (environment_id IS NOT NULL)::int +
        (resource_id IS NOT NULL)::int
      ) = 1)
);
--> statement-breakpoint
CREATE TABLE "notification_channel" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"event_filter" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_secret_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"entries_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"snapshot_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_provider_binding" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" "secret_provider" DEFAULT 'infisical' NOT NULL,
	"provider_project_id" text NOT NULL,
	"provider_project_slug" text NOT NULL,
	"status" "secret_provider_binding_status" DEFAULT 'provisioning' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_reference" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" "secret_provider" NOT NULL,
	"kind" "secret_kind" NOT NULL,
	"logical_scope" "secret_logical_scope" NOT NULL,
	"logical_scope_id" text NOT NULL,
	"key" text NOT NULL,
	"provider_path" text NOT NULL,
	"provider_key" text NOT NULL,
	"provider_version" text,
	"last_resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"cron_expression" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"retention_count" integer DEFAULT 10,
	"retention_days" integer DEFAULT 30,
	"retention_max_size_gb" integer,
	"s3_bucket" text,
	"s3_region" text,
	"s3_endpoint" text,
	"s3_access_key_ref" text,
	"s3_secret_key_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caddy_instance" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"caddy_status" "caddy_status" DEFAULT 'not_installed' NOT NULL,
	"version" text,
	"acme_email" text,
	"last_health_check_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config_file" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"filename" text NOT NULL,
	"content" text NOT NULL,
	"mount_path" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "container_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"username" text,
	"password_secret_ref_id" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_metric" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"timestamp" timestamp NOT NULL,
	"cpu_percent" double precision,
	"memory_used" bigint,
	"memory_limit" bigint,
	"network_rx" bigint,
	"network_tx" bigint,
	"disk_read" bigint,
	"disk_write" bigint
);
--> statement-breakpoint
CREATE TABLE "resource_metric_hourly" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"timestamp" timestamp NOT NULL,
	"cpu_avg" double precision,
	"cpu_max" double precision,
	"cpu_p95" double precision,
	"memory_avg" bigint,
	"memory_max" bigint,
	"memory_p95" bigint,
	"network_rx_total" bigint,
	"network_tx_total" bigint,
	"disk_read_total" bigint,
	"disk_write_total" bigint
);
--> statement-breakpoint
CREATE TABLE "scheduled_task_execution" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"command" text NOT NULL,
	"cron_expression" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"exit_code" integer,
	"stdout" text,
	"stderr" text,
	"duration" integer,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_environment_id_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_triggered_by_user_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_event" ADD CONSTRAINT "deployment_event_deployment_id_deployment_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment" ADD CONSTRAINT "environment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_environment_id_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_position" ADD CONSTRAINT "resource_position_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewport" ADD CONSTRAINT "viewport_environment_id_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_config" ADD CONSTRAINT "database_config_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_build_config" ADD CONSTRAINT "resource_build_config_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_compose_config" ADD CONSTRAINT "resource_compose_config_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_job_config" ADD CONSTRAINT "resource_job_config_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_runtime_config" ADD CONSTRAINT "resource_runtime_config_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_volume_mount" ADD CONSTRAINT "resource_volume_mount_volume_id_resource_volume_id_fk" FOREIGN KEY ("volume_id") REFERENCES "public"."resource_volume"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_volume_mount" ADD CONSTRAINT "resource_volume_mount_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_provider" ADD CONSTRAINT "git_provider_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_provider" ADD CONSTRAINT "git_provider_client_secret_reference_id_secret_reference_id_fk" FOREIGN KEY ("client_secret_reference_id") REFERENCES "public"."secret_reference"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_provider" ADD CONSTRAINT "git_provider_webhook_secret_reference_id_secret_reference_id_fk" FOREIGN KEY ("webhook_secret_reference_id") REFERENCES "public"."secret_reference"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_repository" ADD CONSTRAINT "git_repository_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_repository" ADD CONSTRAINT "git_repository_git_provider_id_git_provider_id_fk" FOREIGN KEY ("git_provider_id") REFERENCES "public"."git_provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server" ADD CONSTRAINT "server_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server" ADD CONSTRAINT "server_ssh_key_id_ssh_key_id_fk" FOREIGN KEY ("ssh_key_id") REFERENCES "public"."ssh_key"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_key" ADD CONSTRAINT "ssh_key_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_key" ADD CONSTRAINT "ssh_key_private_key_secret_reference_id_secret_reference_id_fk" FOREIGN KEY ("private_key_secret_reference_id") REFERENCES "public"."secret_reference"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup" ADD CONSTRAINT "backup_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup" ADD CONSTRAINT "backup_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_domain" ADD CONSTRAINT "custom_domain_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_domain" ADD CONSTRAINT "custom_domain_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_variable" ADD CONSTRAINT "environment_variable_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_variable" ADD CONSTRAINT "environment_variable_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_variable" ADD CONSTRAINT "environment_variable_environment_id_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_variable" ADD CONSTRAINT "environment_variable_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_variable" ADD CONSTRAINT "environment_variable_secret_reference_id_secret_reference_id_fk" FOREIGN KEY ("secret_reference_id") REFERENCES "public"."secret_reference"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channel" ADD CONSTRAINT "notification_channel_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_secret_snapshot" ADD CONSTRAINT "deployment_secret_snapshot_deployment_id_deployment_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_secret_snapshot" ADD CONSTRAINT "deployment_secret_snapshot_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_secret_snapshot" ADD CONSTRAINT "deployment_secret_snapshot_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_provider_binding" ADD CONSTRAINT "secret_provider_binding_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_reference" ADD CONSTRAINT "secret_reference_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_schedule" ADD CONSTRAINT "backup_schedule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_schedule" ADD CONSTRAINT "backup_schedule_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caddy_instance" ADD CONSTRAINT "caddy_instance_server_id_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_file" ADD CONSTRAINT "config_file_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_file" ADD CONSTRAINT "config_file_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_registry" ADD CONSTRAINT "container_registry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_registry" ADD CONSTRAINT "container_registry_password_secret_ref_id_secret_reference_id_fk" FOREIGN KEY ("password_secret_ref_id") REFERENCES "public"."secret_reference"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_metric" ADD CONSTRAINT "resource_metric_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_metric_hourly" ADD CONSTRAINT "resource_metric_hourly_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_task_execution" ADD CONSTRAINT "scheduled_task_execution_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_task_execution" ADD CONSTRAINT "scheduled_task_execution_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "apikey_userId_idx" ON "apikey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "twoFactor_secret_idx" ON "two_factor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "twoFactor_userId_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "deployment_org_idx" ON "deployment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "deployment_project_idx" ON "deployment" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "deployment_resource_idx" ON "deployment" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "deployment_status_idx" ON "deployment" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deployment_created_idx" ON "deployment" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "deployment_event_deployment_idx" ON "deployment_event" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "deployment_event_created_idx" ON "deployment_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "environment_projectId_idx" ON "environment" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "environment_project_name_uidx" ON "environment" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "project_slug_org_uidx" ON "project" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "project_ownerUserId_idx" ON "project" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "project_org_idx" ON "project" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "resource_org_idx" ON "resource" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "resource_environmentId_idx" ON "resource" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX "resource_kind_idx" ON "resource" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "resource_serverId_idx" ON "resource" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "database_config_resource_idx" ON "database_config" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "database_config_type_idx" ON "database_config" USING btree ("database_type");--> statement-breakpoint
CREATE INDEX "resource_build_config_resource_idx" ON "resource_build_config" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "resource_build_config_registry_idx" ON "resource_build_config" USING btree ("registry_id");--> statement-breakpoint
CREATE INDEX "resource_compose_config_resource_idx" ON "resource_compose_config" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "resource_job_config_resource_idx" ON "resource_job_config" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "resource_runtime_config_resource_idx" ON "resource_runtime_config" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "resource_volume_org_idx" ON "resource_volume" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "resource_volume_mount_volume_idx" ON "resource_volume_mount" USING btree ("volume_id");--> statement-breakpoint
CREATE INDEX "resource_volume_mount_resource_idx" ON "resource_volume_mount" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "git_provider_org_idx" ON "git_provider" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "git_provider_client_secret_ref_idx" ON "git_provider" USING btree ("client_secret_reference_id");--> statement-breakpoint
CREATE INDEX "git_provider_webhook_secret_ref_idx" ON "git_provider" USING btree ("webhook_secret_reference_id");--> statement-breakpoint
CREATE INDEX "git_repo_resource_idx" ON "git_repository" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "server_org_idx" ON "server" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ssh_key_org_idx" ON "ssh_key" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ssh_key_secret_ref_idx" ON "ssh_key" USING btree ("private_key_secret_reference_id");--> statement-breakpoint
CREATE INDEX "audit_log_org_idx" ON "audit_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "backup_org_idx" ON "backup" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "backup_resource_idx" ON "backup" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "backup_created_idx" ON "backup" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "custom_domain_org_idx" ON "custom_domain" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "custom_domain_resource_idx" ON "custom_domain" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_domain_domain_unique" ON "custom_domain" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "env_var_org_idx" ON "environment_variable" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "env_var_project_idx" ON "environment_variable" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "env_var_environment_idx" ON "environment_variable" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX "env_var_resource_idx" ON "environment_variable" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "env_var_secret_ref_idx" ON "environment_variable" USING btree ("secret_reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "env_var_project_key_unique" ON "environment_variable" USING btree ("project_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "env_var_environment_key_unique" ON "environment_variable" USING btree ("environment_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "env_var_resource_key_unique" ON "environment_variable" USING btree ("resource_id","key");--> statement-breakpoint
CREATE INDEX "notification_channel_org_idx" ON "notification_channel" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_secret_snapshot_deployment_uidx" ON "deployment_secret_snapshot" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "deployment_secret_snapshot_org_idx" ON "deployment_secret_snapshot" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "deployment_secret_snapshot_resource_idx" ON "deployment_secret_snapshot" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "secret_provider_binding_org_uidx" ON "secret_provider_binding" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "secret_provider_binding_status_idx" ON "secret_provider_binding" USING btree ("status");--> statement-breakpoint
CREATE INDEX "secret_reference_org_idx" ON "secret_reference" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "secret_reference_scope_idx" ON "secret_reference" USING btree ("logical_scope","logical_scope_id");--> statement-breakpoint
CREATE INDEX "secret_reference_provider_idx" ON "secret_reference" USING btree ("provider","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "secret_reference_scope_key_uidx" ON "secret_reference" USING btree ("organization_id","kind","logical_scope","logical_scope_id","key");--> statement-breakpoint
CREATE INDEX "backup_schedule_resource_idx" ON "backup_schedule" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "backup_schedule_org_idx" ON "backup_schedule" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "caddy_instance_server_idx" ON "caddy_instance" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "config_file_resource_idx" ON "config_file" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "config_file_org_idx" ON "config_file" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "container_registry_org_idx" ON "container_registry" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "resource_metric_resource_ts_idx" ON "resource_metric" USING btree ("resource_id","timestamp");--> statement-breakpoint
CREATE INDEX "resource_metric_ts_idx" ON "resource_metric" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "resource_metric_hourly_resource_ts_idx" ON "resource_metric_hourly" USING btree ("resource_id","timestamp");--> statement-breakpoint
CREATE INDEX "resource_metric_hourly_ts_idx" ON "resource_metric_hourly" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "scheduled_task_resource_idx" ON "scheduled_task_execution" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "scheduled_task_org_idx" ON "scheduled_task_execution" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "scheduled_task_created_idx" ON "scheduled_task_execution" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "webhook_delivery_created_idx" ON "webhook_delivery" USING btree ("created_at");