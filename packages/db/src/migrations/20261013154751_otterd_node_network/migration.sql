CREATE TABLE "otterd_address_plan" (
	"id" integer PRIMARY KEY,
	"plan" jsonb NOT NULL,
	"revision" integer NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otterd_scope" (
	"scope_id" text PRIMARY KEY,
	"zone" text NOT NULL,
	"resolver" text NOT NULL UNIQUE,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otterd_serving" (
	"resource_id" text PRIMARY KEY,
	"revision" integer NOT NULL,
	"attempts" jsonb NOT NULL,
	"withdrawals" jsonb NOT NULL,
	"listed" jsonb NOT NULL,
	"sent_to" jsonb NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "otterd_grant" ADD COLUMN "network" jsonb;--> statement-breakpoint
ALTER TABLE "otterd_grant" ADD COLUMN "network_released_at" bigint;--> statement-breakpoint
ALTER TABLE "otterd_service" ADD COLUMN "vip_id" text;--> statement-breakpoint
ALTER TABLE "otterd_service" ADD COLUMN "vip_address" text;--> statement-breakpoint
CREATE UNIQUE INDEX "otterd_service_vip_address" ON "otterd_service" ("vip_address");--> statement-breakpoint
ALTER TABLE "otterd_serving" ADD CONSTRAINT "otterd_serving_resource_id_otterd_service_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "otterd_service"("resource_id") ON DELETE CASCADE;