CREATE TYPE "server_firewall_status" AS ENUM('unknown', 'applied', 'failed', 'unsupported');--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "firewall_status" "server_firewall_status" DEFAULT 'unknown'::"server_firewall_status" NOT NULL;--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "firewall_applied_at" timestamp;--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "firewall_error" text;--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "firewall_bouncer_active" boolean DEFAULT false NOT NULL;