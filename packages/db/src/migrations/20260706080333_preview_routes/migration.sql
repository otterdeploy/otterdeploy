ALTER TABLE "proxy_route" ADD COLUMN "environment_id" text;--> statement-breakpoint
CREATE INDEX "proxy_route_environment_id_idx" ON "proxy_route" ("environment_id");--> statement-breakpoint
ALTER TABLE "proxy_route" ADD CONSTRAINT "proxy_route_environment_id_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environment"("id") ON DELETE CASCADE;