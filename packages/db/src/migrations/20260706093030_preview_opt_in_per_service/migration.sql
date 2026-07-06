ALTER TABLE "service_resource" ADD COLUMN "previews_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "previews_enabled";