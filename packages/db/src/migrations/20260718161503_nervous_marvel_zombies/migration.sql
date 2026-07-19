CREATE TYPE "orphaned_resource_type" AS ENUM('service', 'volume', 'network', 'image', 'compose_stack');--> statement-breakpoint
CREATE TABLE "orphaned_resource" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"server_id" text,
	"resource_type" "orphaned_resource_type" NOT NULL,
	"ref" text NOT NULL,
	"project_id" text,
	"label" text,
	"payload" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "orphaned_resource_org_created_idx" ON "orphaned_resource" ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "orphaned_resource_last_attempt_idx" ON "orphaned_resource" ("last_attempt_at");--> statement-breakpoint
ALTER TABLE "orphaned_resource" ADD CONSTRAINT "orphaned_resource_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;