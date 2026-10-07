ALTER TABLE "compose_resource" ADD COLUMN "docker_socket_granted_at" timestamp;--> statement-breakpoint
ALTER TABLE "compose_resource" ADD COLUMN "docker_socket_granted_by" text;