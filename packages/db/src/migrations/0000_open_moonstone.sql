CREATE TYPE "public"."database_engine" AS ENUM('postgres', 'redis', 'mariadb', 'mongodb');--> statement-breakpoint
CREATE TYPE "public"."deployment_reason" AS ENUM('create', 'redeploy', 'env-change', 'image-change', 'restart');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('pending', 'building', 'running', 'failed', 'superseded', 'removed');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'valid', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."resource_status" AS ENUM('draft', 'valid', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."resource_type" AS ENUM('database', 'service');--> statement-breakpoint
CREATE TYPE "public"."service_app_protocol" AS ENUM('http', 'tcp');--> statement-breakpoint
CREATE TYPE "public"."service_mount_type" AS ENUM('volume', 'bind', 'file');--> statement-breakpoint
CREATE TYPE "public"."service_port_protocol" AS ENUM('tcp', 'udp');--> statement-breakpoint
CREATE TYPE "public"."service_restart_condition" AS ENUM('none', 'on-failure', 'any');--> statement-breakpoint
CREATE TYPE "public"."proxy_route_protocol" AS ENUM('tcp', 'http');--> statement-breakpoint
CREATE TYPE "public"."proxy_route_type" AS ENUM('http', 'layer4');--> statement-breakpoint
CREATE TYPE "public"."server_availability" AS ENUM('active', 'drain', 'pause');--> statement-breakpoint
CREATE TYPE "public"."server_role" AS ENUM('manager', 'worker');--> statement-breakpoint
CREATE TYPE "public"."server_status" AS ENUM('ready', 'draining', 'down');--> statement-breakpoint
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
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"team_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
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
	"active_organization_id" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
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
CREATE TABLE "database_resource" (
	"resource_id" text PRIMARY KEY NOT NULL,
	"engine" "database_engine" DEFAULT 'postgres' NOT NULL,
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
	"engine_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extra_env" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"image" text NOT NULL,
	"reason" "deployment_reason" DEFAULT 'create' NOT NULL,
	"status" "deployment_status" DEFAULT 'pending' NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environment" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"environment_id" text,
	"stack_file" text,
	"stack_file_version" integer DEFAULT 0 NOT NULL,
	"last_applied_file" text,
	"last_applied_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "project_env_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"service_resource_id" text NOT NULL,
	"project_env_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_env_var" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"is_secret" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "resource_type" NOT NULL,
	"status" "resource_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_env_var" (
	"id" text PRIMARY KEY NOT NULL,
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
	"id" text PRIMARY KEY NOT NULL,
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
	"id" text PRIMARY KEY NOT NULL,
	"service_resource_id" text NOT NULL,
	"container_port" integer NOT NULL,
	"protocol" "service_port_protocol" DEFAULT 'tcp' NOT NULL,
	"app_protocol" "service_app_protocol" DEFAULT 'http' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_resource" (
	"resource_id" text PRIMARY KEY NOT NULL,
	"image" text NOT NULL,
	"image_digest" text,
	"command" text[],
	"entrypoint" text[],
	"replicas" integer DEFAULT 1 NOT NULL,
	"restart_condition" "service_restart_condition" DEFAULT 'on-failure' NOT NULL,
	"restart_max_attempts" integer,
	"restart_delay_ms" integer DEFAULT 5000 NOT NULL,
	"healthcheck_cmd" text[],
	"healthcheck_interval_ms" integer,
	"healthcheck_timeout_ms" integer,
	"healthcheck_retries" integer,
	"healthcheck_start_ms" integer,
	"cpu_limit" numeric(4, 2),
	"memory_limit_mb" integer,
	"cpu_reservation" numeric(4, 2),
	"memory_reservation_mb" integer,
	"internal_hostname" text NOT NULL,
	"service_name" text NOT NULL,
	"network_name" text NOT NULL,
	"public_enabled" boolean DEFAULT false NOT NULL,
	"public_domain" text,
	"force_update_counter" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_member" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proxy_route" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"resource_id" text,
	"type" "proxy_route_type" NOT NULL,
	"domain" text NOT NULL,
	"upstream_host" text NOT NULL,
	"upstream_port" integer NOT NULL,
	"protocol" "proxy_route_protocol" NOT NULL,
	"layer4_alpn" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"hostname" text,
	"host" text NOT NULL,
	"region" text,
	"role" "server_role" DEFAULT 'worker' NOT NULL,
	"status" "server_status" DEFAULT 'ready' NOT NULL,
	"availability" "server_availability" DEFAULT 'active' NOT NULL,
	"cpu_total" integer NOT NULL,
	"mem_total_gb" integer NOT NULL,
	"disk_total_gb" integer,
	"disk_unit" text DEFAULT 'GB' NOT NULL,
	"daemon_version" text,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_resource" ADD CONSTRAINT "database_resource_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment" ADD CONSTRAINT "environment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_env_subscription" ADD CONSTRAINT "project_env_subscription_service_resource_id_service_resource_resource_id_fk" FOREIGN KEY ("service_resource_id") REFERENCES "public"."service_resource"("resource_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_env_var" ADD CONSTRAINT "project_env_var_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_env_var" ADD CONSTRAINT "project_env_var_environment_id_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_env_var" ADD CONSTRAINT "service_env_var_service_resource_id_service_resource_resource_id_fk" FOREIGN KEY ("service_resource_id") REFERENCES "public"."service_resource"("resource_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_env_var" ADD CONSTRAINT "service_env_var_environment_id_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_mount" ADD CONSTRAINT "service_mount_service_resource_id_service_resource_resource_id_fk" FOREIGN KEY ("service_resource_id") REFERENCES "public"."service_resource"("resource_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_port" ADD CONSTRAINT "service_port_service_resource_id_service_resource_resource_id_fk" FOREIGN KEY ("service_resource_id") REFERENCES "public"."service_resource"("resource_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_resource" ADD CONSTRAINT "service_resource_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_team_id_project_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_route" ADD CONSTRAINT "proxy_route_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server" ADD CONSTRAINT "server_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "database_resource_database_name_unique" ON "database_resource" USING btree ("database_name");--> statement-breakpoint
CREATE UNIQUE INDEX "database_resource_username_unique" ON "database_resource" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "database_resource_public_hostname_unique" ON "database_resource" USING btree ("public_hostname");--> statement-breakpoint
CREATE UNIQUE INDEX "database_resource_internal_hostname_unique" ON "database_resource" USING btree ("internal_hostname");--> statement-breakpoint
CREATE INDEX "deployment_resource_id_idx" ON "deployment" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "deployment_resource_created_idx" ON "deployment" USING btree ("resource_id","created_at");--> statement-breakpoint
CREATE INDEX "environment_project_id_idx" ON "environment" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "environment_project_slug_unique" ON "environment" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "project_slug_idx" ON "project" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "project_organization_id_idx" ON "project" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_env_subscription_unique" ON "project_env_subscription" USING btree ("service_resource_id","project_env_key");--> statement-breakpoint
CREATE INDEX "project_env_subscription_service_resource_id_idx" ON "project_env_subscription" USING btree ("service_resource_id");--> statement-breakpoint
CREATE INDEX "project_env_subscription_key_idx" ON "project_env_subscription" USING btree ("project_env_key");--> statement-breakpoint
CREATE UNIQUE INDEX "project_env_var_unique" ON "project_env_var" USING btree ("project_id","environment_id","key");--> statement-breakpoint
CREATE INDEX "project_env_var_project_id_idx" ON "project_env_var" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_env_var_environment_id_idx" ON "project_env_var" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX "project_env_var_key_idx" ON "project_env_var" USING btree ("project_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_project_name_unique" ON "resource" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "resource_project_id_idx" ON "resource" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_env_var_unique" ON "service_env_var" USING btree ("service_resource_id","key");--> statement-breakpoint
CREATE INDEX "service_env_var_service_resource_id_idx" ON "service_env_var" USING btree ("service_resource_id");--> statement-breakpoint
CREATE INDEX "service_env_var_environment_id_idx" ON "service_env_var" USING btree ("environment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_mount_target_unique" ON "service_mount" USING btree ("service_resource_id","target");--> statement-breakpoint
CREATE INDEX "service_mount_service_resource_id_idx" ON "service_mount" USING btree ("service_resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_port_unique" ON "service_port" USING btree ("service_resource_id","container_port","protocol");--> statement-breakpoint
CREATE INDEX "service_port_service_resource_id_idx" ON "service_port" USING btree ("service_resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_resource_service_name_unique" ON "service_resource" USING btree ("service_name");--> statement-breakpoint
CREATE UNIQUE INDEX "service_resource_internal_hostname_unique" ON "service_resource" USING btree ("internal_hostname");--> statement-breakpoint
CREATE UNIQUE INDEX "service_resource_public_domain_unique" ON "service_resource" USING btree ("public_domain");--> statement-breakpoint
CREATE INDEX "team_member_team_id_idx" ON "team_member" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_member_user_id_idx" ON "team_member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proxy_route_domain_unique" ON "proxy_route" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "proxy_route_project_id_idx" ON "proxy_route" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "proxy_route_resource_id_idx" ON "proxy_route" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "server_organization_id_idx" ON "server" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "server_org_host_unique" ON "server" USING btree ("organization_id","host");