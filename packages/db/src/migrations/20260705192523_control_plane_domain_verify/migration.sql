ALTER TABLE "platform_settings" ADD COLUMN "control_plane_fqdn_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "control_plane_fqdn_verify_token" text;