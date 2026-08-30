CREATE TYPE "mesh_edge_status" AS ENUM('absent', 'starting', 'ready', 'error');--> statement-breakpoint
ALTER TABLE "mesh_network" ADD COLUMN "edge_status" "mesh_edge_status" DEFAULT 'absent'::"mesh_edge_status" NOT NULL;--> statement-breakpoint
ALTER TABLE "mesh_network" ADD COLUMN "edge_container_id" text;--> statement-breakpoint
ALTER TABLE "mesh_network" ADD COLUMN "edge_caddy_container_id" text;--> statement-breakpoint
ALTER TABLE "mesh_network" ADD COLUMN "edge_hostname" text;--> statement-breakpoint
ALTER TABLE "mesh_network" ADD COLUMN "edge_peer_id" text;--> statement-breakpoint
ALTER TABLE "mesh_network" ADD COLUMN "edge_address" text;--> statement-breakpoint
ALTER TABLE "mesh_network" ADD COLUMN "edge_error" text;--> statement-breakpoint
ALTER TABLE "mesh_network" ADD COLUMN "edge_checked_at" timestamp;