CREATE TYPE "mesh_network_status" AS ENUM('connected', 'error', 'disconnected');--> statement-breakpoint
CREATE TYPE "mesh_provider_kind" AS ENUM('netbird', 'tailscale');--> statement-breakpoint
CREATE TYPE "proxy_route_exposure_scope" AS ENUM('public', 'private', 'both');--> statement-breakpoint
ALTER TYPE "backup_destination_status" ADD VALUE 'disabled';--> statement-breakpoint
CREATE TABLE "mesh_network" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"provider" "mesh_provider_kind" NOT NULL,
	"management_url" text NOT NULL,
	"api_token_ciphertext" text NOT NULL,
	"oauth_client_id" text,
	"account_id" text,
	"peer_domain" text,
	"dns_label" text DEFAULT 'od' NOT NULL,
	"node_group_id" text,
	"access_group_ids" jsonb DEFAULT '[]' NOT NULL,
	"status" "mesh_network_status" DEFAULT 'connected'::"mesh_network_status" NOT NULL,
	"last_verified_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backup_destination" ADD COLUMN "managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "registration_mode" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "github_oauth_enabled" boolean;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "github_oauth_client_id" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "github_oauth_client_secret_ciphertext" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "google_oauth_enabled" boolean;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "google_oauth_client_id" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "google_oauth_client_secret_ciphertext" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "gitlab_oauth_enabled" boolean;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "gitlab_oauth_client_id" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "gitlab_oauth_client_secret_ciphertext" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "gitlab_oauth_issuer" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "twilio_account_sid" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "twilio_auth_token_ciphertext" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "twilio_from_number" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "fcm_server_key_ciphertext" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "crowdsec_lapi_url" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "crowdsec_bouncer_key_ciphertext" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "crowdsec_enabled" boolean;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "egress_allowlist" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "preview_idle_teardown_hours" integer;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "edge_log_persist" boolean;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "edge_log_retention_days" integer;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "edge_log_geoip_url" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "edge_log_geoip_asn_url" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "builder_concurrency" integer;--> statement-breakpoint
ALTER TABLE "proxy_route" ADD COLUMN "exposure_scope" "proxy_route_exposure_scope" DEFAULT 'public'::"proxy_route_exposure_scope" NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "backup_destination_managed_org_idx" ON "backup_destination" ("organization_id") WHERE "managed";--> statement-breakpoint
CREATE UNIQUE INDEX "mesh_network_org_unique" ON "mesh_network" ("organization_id");--> statement-breakpoint
CREATE INDEX "mesh_network_status_idx" ON "mesh_network" ("status");--> statement-breakpoint
ALTER TABLE "mesh_network" ADD CONSTRAINT "mesh_network_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;