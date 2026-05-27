CREATE TYPE "public"."service_source" AS ENUM('image', 'git');--> statement-breakpoint
ALTER TABLE "service_resource" ADD COLUMN "source" "service_source" DEFAULT 'image' NOT NULL;--> statement-breakpoint
ALTER TABLE "service_resource" ADD COLUMN "source_subdir" text;