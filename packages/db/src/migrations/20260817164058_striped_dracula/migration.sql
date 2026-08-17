CREATE TYPE "backup_approach" AS ENUM('logical', 'physical');--> statement-breakpoint
ALTER TABLE "backup" ADD COLUMN "approach" "backup_approach" DEFAULT 'logical'::"backup_approach" NOT NULL;