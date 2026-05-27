CREATE TABLE "platform_settings" (
	"id" text PRIMARY KEY DEFAULT 'platform' NOT NULL,
	"control_plane_fqdn" text,
	"server_ip" text,
	"acme_email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "base_domain" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "base_domain_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "base_domain_verify_token" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "cloudflare_api_token" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "cloudflare_zone_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "custom_domain" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "custom_domain_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "custom_domain_verify_token" text;