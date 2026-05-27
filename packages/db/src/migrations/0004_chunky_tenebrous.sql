CREATE TYPE "public"."container_registry_auth" AS ENUM('password', 'token');--> statement-breakpoint
CREATE TYPE "public"."deployment_log_stream" AS ENUM('stdout', 'stderr', 'system');--> statement-breakpoint
CREATE TABLE "container_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"display_name" text NOT NULL,
	"host" text NOT NULL,
	"username" text NOT NULL,
	"encrypted_password" text NOT NULL,
	"auth_type" "container_registry_auth" DEFAULT 'password' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_log" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"stream" "deployment_log_stream" NOT NULL,
	"line" text NOT NULL,
	"ts" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "container_registry_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "image_repository" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "nixpacks_config" jsonb DEFAULT 'null'::jsonb;--> statement-breakpoint
ALTER TABLE "container_registry" ADD CONSTRAINT "container_registry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_log" ADD CONSTRAINT "deployment_log_deployment_id_deployment_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "container_registry_org_idx" ON "container_registry" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "container_registry_host_idx" ON "container_registry" USING btree ("host");--> statement-breakpoint
CREATE UNIQUE INDEX "container_registry_org_host_user_uq" ON "container_registry" USING btree ("organization_id","host","username");--> statement-breakpoint
CREATE INDEX "deployment_log_deployment_seq_idx" ON "deployment_log" USING btree ("deployment_id","seq");--> statement-breakpoint
CREATE INDEX "project_container_registry_id_idx" ON "project" USING btree ("container_registry_id");