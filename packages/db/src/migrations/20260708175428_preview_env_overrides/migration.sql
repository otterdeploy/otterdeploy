ALTER TABLE "service_env_var" ADD COLUMN "preview_id" text;--> statement-breakpoint
DROP INDEX "service_env_var_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "service_env_var_unique" ON "service_env_var" ("service_resource_id","key") WHERE preview_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "service_env_var_preview_unique" ON "service_env_var" ("service_resource_id","preview_id","key") WHERE preview_id is not null;--> statement-breakpoint
CREATE INDEX "service_env_var_preview_id_idx" ON "service_env_var" ("preview_id");--> statement-breakpoint
ALTER TABLE "service_env_var" ADD CONSTRAINT "service_env_var_preview_id_preview_id_fkey" FOREIGN KEY ("preview_id") REFERENCES "preview"("id") ON DELETE CASCADE;