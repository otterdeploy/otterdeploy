CREATE TYPE "server_mesh_provider" AS ENUM('none', 'tailscale', 'netbird');--> statement-breakpoint
CREATE TYPE "server_provision_status" AS ENUM('pending', 'provisioning', 'joining', 'ready', 'failed');--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "provision_status" "server_provision_status" DEFAULT 'ready'::"server_provision_status" NOT NULL;--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "provision_error" text;--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "ssh_key_id" text;--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "ssh_user" text DEFAULT 'root' NOT NULL;--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "ssh_port" integer DEFAULT 22 NOT NULL;--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "mesh_provider" "server_mesh_provider" DEFAULT 'none'::"server_mesh_provider" NOT NULL;--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "mesh_address" text;--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "build_server" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "server" ADD CONSTRAINT "server_ssh_key_id_ssh_key_id_fkey" FOREIGN KEY ("ssh_key_id") REFERENCES "ssh_key"("id") ON DELETE SET NULL;