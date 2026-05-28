ALTER TABLE "project" ADD COLUMN "manifest" jsonb;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "manifest_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "last_applied_manifest" jsonb;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "last_manifest_applied_at" timestamp;