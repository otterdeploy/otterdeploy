ALTER TABLE "backup_destination" ADD COLUMN "used_for_backups" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Every row that already existed WAS a backup destination: before this column
-- there was no other kind, and live schedules reference these ids. Defaulting
-- them to false would turn those schedules into no-ops without saying so, so
-- the opt-in starts from "yes" for history and "no" for everything new.
UPDATE "backup_destination" SET "used_for_backups" = true;
