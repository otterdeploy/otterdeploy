ALTER TABLE "platform_settings" ADD COLUMN "control_plane_backup_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "control_plane_backup_destination_id" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "control_plane_recovery_key_fingerprint" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "control_plane_recovery_key_generated_at" timestamp;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "control_plane_recovery_key_exported_at" timestamp;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "control_plane_last_backup_at" timestamp;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "control_plane_last_run_status" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "control_plane_last_run_at" timestamp;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "control_plane_last_run_error" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "control_plane_last_backup_size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_0DSHsk0n5iKW_fkey" FOREIGN KEY ("control_plane_backup_destination_id") REFERENCES "backup_destination"("id") ON DELETE SET NULL;