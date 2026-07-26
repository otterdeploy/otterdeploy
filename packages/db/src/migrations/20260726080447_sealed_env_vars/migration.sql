ALTER TABLE "project_env_var" ADD COLUMN "sealed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service_env_var" ADD COLUMN "sealed" boolean DEFAULT false NOT NULL;