ALTER TABLE "resource" ADD COLUMN "environment_id" text;--> statement-breakpoint
DROP INDEX "resource_project_name_base_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "resource_project_name_base_unique" ON "resource" ("project_id","name") WHERE preview_id is null and environment_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_project_name_env_unique" ON "resource" ("project_id","environment_id","name") WHERE environment_id is not null and preview_id is null;--> statement-breakpoint
CREATE INDEX "resource_environment_id_idx" ON "resource" ("environment_id");