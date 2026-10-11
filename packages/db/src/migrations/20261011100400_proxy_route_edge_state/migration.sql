-- Whether the edge runs what a route row says. Route writes answer once the
-- row is saved and the proxy reload runs behind them; the reload settles each
-- row it carried as synced, or failed with the reason. Existing rows are ones
-- the edge already has, so they start synced.
CREATE TYPE "proxy_route_edge_state" AS ENUM('synced', 'pending', 'failed');--> statement-breakpoint
ALTER TABLE "proxy_route" ADD COLUMN "edge_state" "proxy_route_edge_state" DEFAULT 'synced'::"proxy_route_edge_state" NOT NULL;--> statement-breakpoint
ALTER TABLE "proxy_route" ADD COLUMN "edge_error" text;--> statement-breakpoint
ALTER TABLE "proxy_route" ADD COLUMN "edge_revision" integer DEFAULT 0 NOT NULL;