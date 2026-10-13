ALTER TABLE "otterd_enroll_token" ADD COLUMN "server_id" text;--> statement-breakpoint
ALTER TABLE "otterd_node" ADD COLUMN "server_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "otterd_node_server" ON "otterd_node" ("server_id") WHERE "server_id" is not null;