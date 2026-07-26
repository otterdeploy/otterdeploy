ALTER TABLE "proxy_route" ADD COLUMN "route_policy" jsonb DEFAULT '{"compression":"off","maxRequestBodyMb":null,"hsts":"off","contentTypeNosniff":false,"frameOptions":"off","referrerPolicy":"off","contentSecurityPolicy":null}' NOT NULL;--> statement-breakpoint
ALTER TABLE "proxy_route" ADD COLUMN "domain_verify_token" text;--> statement-breakpoint
ALTER TABLE "proxy_route" ADD COLUMN "domain_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "proxy_route" DROP COLUMN "custom_directives";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "custom_caddy_config";