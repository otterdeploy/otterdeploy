ALTER TABLE "otterd_service" ADD COLUMN "service_name" text;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "runtime_owner" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "otterd_service_name" ON "otterd_service" ("service_name");