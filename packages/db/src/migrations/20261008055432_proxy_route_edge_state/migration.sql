CREATE TYPE "proxy_route_edge_state" AS ENUM('synced', 'pending', 'failed');--> statement-breakpoint
ALTER TABLE "proxy_route" ADD COLUMN "edge_state" "proxy_route_edge_state" DEFAULT 'synced'::"proxy_route_edge_state" NOT NULL;--> statement-breakpoint
ALTER TABLE "proxy_route" ADD COLUMN "edge_error" text;--> statement-breakpoint
ALTER TABLE "proxy_route" ADD COLUMN "edge_revision" integer DEFAULT 0 NOT NULL;