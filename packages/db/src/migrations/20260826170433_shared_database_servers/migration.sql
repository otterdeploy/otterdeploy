ALTER TABLE "database_resource" ADD COLUMN "host_resource_id" text;--> statement-breakpoint
ALTER TABLE "database_resource" ADD COLUMN "connection_limit" integer;--> statement-breakpoint
CREATE INDEX "database_resource_host_resource_id_idx" ON "database_resource" ("host_resource_id");