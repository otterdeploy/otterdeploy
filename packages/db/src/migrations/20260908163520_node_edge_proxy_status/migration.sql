CREATE TYPE "server_edge_proxy_status" AS ENUM('unknown', 'running', 'port_conflict', 'platform_present', 'failed', 'unsupported');--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "edge_proxy_status" "server_edge_proxy_status" DEFAULT 'unknown'::"server_edge_proxy_status" NOT NULL;--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "edge_proxy_error" text;