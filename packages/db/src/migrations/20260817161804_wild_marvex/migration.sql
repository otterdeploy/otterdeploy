CREATE TYPE "backup_restore_mode" AS ENUM('download', 'in-place');--> statement-breakpoint
CREATE TYPE "backup_restore_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "backup_verification_status" AS ENUM('queued', 'running', 'passed', 'failed');--> statement-breakpoint
CREATE TYPE "backup_verification_trigger" AS ENUM('manual', 'after-backup');--> statement-breakpoint
CREATE TYPE "backup_verified_status" AS ENUM('none', 'running', 'passed', 'failed');--> statement-breakpoint
ALTER TYPE "backup_destination_type" ADD VALUE 'azblob';--> statement-breakpoint
ALTER TYPE "backup_destination_type" ADD VALUE 'gcs';--> statement-breakpoint
CREATE TABLE "backup_lock" (
	"scope" text PRIMARY KEY,
	"backup_id" text NOT NULL,
	"claimed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_restore" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"backup_id" text NOT NULL,
	"mode" "backup_restore_mode" NOT NULL,
	"target_resource_id" text,
	"status" "backup_restore_status" DEFAULT 'running'::"backup_restore_status" NOT NULL,
	"error_message" text,
	"duration_ms" integer,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_verification" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"backup_id" text NOT NULL,
	"status" "backup_verification_status" DEFAULT 'queued'::"backup_verification_status" NOT NULL,
	"trigger" "backup_verification_trigger" DEFAULT 'manual'::"backup_verification_trigger" NOT NULL,
	"checks" jsonb,
	"fail_message" text,
	"duration_ms" integer,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backup" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "backup" ADD COLUMN "verified_status" "backup_verified_status" DEFAULT 'none'::"backup_verified_status" NOT NULL;--> statement-breakpoint
ALTER TABLE "backup" ADD COLUMN "verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "backup_schedule" ADD COLUMN "keep_last" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_schedule" ADD COLUMN "keep_hourly" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_schedule" ADD COLUMN "max_retries" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_schedule" ADD COLUMN "verify_after_backup" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_schedule" ADD COLUMN "overdue_after_hours" integer;--> statement-breakpoint
ALTER TABLE "backup_schedule" ADD COLUMN "overdue_notified_at" timestamp;--> statement-breakpoint
CREATE INDEX "backup_restore_backup_idx" ON "backup_restore" ("backup_id","created_at");--> statement-breakpoint
CREATE INDEX "backup_verification_backup_idx" ON "backup_verification" ("backup_id","created_at");--> statement-breakpoint
ALTER TABLE "backup_lock" ADD CONSTRAINT "backup_lock_backup_id_backup_id_fkey" FOREIGN KEY ("backup_id") REFERENCES "backup"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "backup_restore" ADD CONSTRAINT "backup_restore_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "backup_restore" ADD CONSTRAINT "backup_restore_backup_id_backup_id_fkey" FOREIGN KEY ("backup_id") REFERENCES "backup"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "backup_verification" ADD CONSTRAINT "backup_verification_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "backup_verification" ADD CONSTRAINT "backup_verification_backup_id_backup_id_fkey" FOREIGN KEY ("backup_id") REFERENCES "backup"("id") ON DELETE CASCADE;