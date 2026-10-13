CREATE TABLE "otterd_migration_resource" (
	"resource_id" text PRIMARY KEY,
	"session_id" text NOT NULL,
	"state" text NOT NULL,
	"node_id" text,
	"service_name" text,
	"container_id" text,
	"before_image" jsonb,
	"grant_id" text,
	"error" text,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otterd_migration_session" (
	"session_id" text PRIMARY KEY,
	"state" text NOT NULL,
	"opened_by" text NOT NULL,
	"opened_at" bigint NOT NULL,
	"finalized_at" bigint
);
--> statement-breakpoint
ALTER TABLE "otterd_grant" ADD COLUMN "adopts_container" text;--> statement-breakpoint
ALTER TABLE "otterd_grant" ADD COLUMN "adopted_removed_at" bigint;--> statement-breakpoint
ALTER TABLE "otterd_migration_resource" ADD CONSTRAINT "otterd_migration_resource_ngwSY6oqF6pV_fkey" FOREIGN KEY ("session_id") REFERENCES "otterd_migration_session"("session_id");