CREATE TYPE "analytics_funnel_scope" AS ENUM('visitor', 'session');--> statement-breakpoint
CREATE TABLE "analytics_event_definition" (
	"id" text PRIMARY KEY,
	"site_id" text NOT NULL,
	"name" text NOT NULL,
	"display_name" text,
	"conversion" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_funnel" (
	"id" text PRIMARY KEY,
	"site_id" text NOT NULL,
	"name" text NOT NULL,
	"steps" jsonb NOT NULL,
	"scope" "analytics_funnel_scope" DEFAULT 'visitor'::"analytics_funnel_scope" NOT NULL,
	"window_hours" integer DEFAULT 24 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_session" (
	"id" text PRIMARY KEY,
	"site_id" text NOT NULL,
	"visitor_id" text NOT NULL,
	"external_user_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	"pageviews" integer DEFAULT 0 NOT NULL,
	"events" integer DEFAULT 0 NOT NULL,
	"active_ms" integer DEFAULT 0 NOT NULL,
	"scroll" smallint,
	"entry_path" text NOT NULL,
	"exit_path" text NOT NULL,
	"host" text NOT NULL,
	"referrer_host" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_term" text,
	"utm_content" text,
	"country" text,
	"browser" text NOT NULL,
	"os" text NOT NULL,
	"device" text NOT NULL,
	"screen_w" smallint,
	"language" text
);
--> statement-breakpoint
CREATE TABLE "analytics_site" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"public_key" text NOT NULL,
	"key_rotated_at" timestamp with time zone,
	"extra_hosts" text[] DEFAULT '{}'::text[] NOT NULL,
	"exclude_paths" text[] DEFAULT '{}'::text[] NOT NULL,
	"respect_dnt" boolean DEFAULT false NOT NULL,
	"require_consent" boolean DEFAULT false NOT NULL,
	"first_event_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "analytics_retention_days" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_event_definition_site_name_unique" ON "analytics_event_definition" ("site_id","name");--> statement-breakpoint
CREATE INDEX "analytics_funnel_site_idx" ON "analytics_funnel" ("site_id");--> statement-breakpoint
CREATE INDEX "analytics_session_site_started_idx" ON "analytics_session" ("site_id","started_at");--> statement-breakpoint
CREATE INDEX "analytics_session_site_visitor_last_idx" ON "analytics_session" ("site_id","visitor_id","last_at");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_site_project_unique" ON "analytics_site" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_site_public_key_unique" ON "analytics_site" ("public_key");--> statement-breakpoint
CREATE INDEX "analytics_site_organization_id_idx" ON "analytics_site" ("organization_id");--> statement-breakpoint
ALTER TABLE "analytics_event_definition" ADD CONSTRAINT "analytics_event_definition_site_id_analytics_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "analytics_site"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "analytics_funnel" ADD CONSTRAINT "analytics_funnel_site_id_analytics_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "analytics_site"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "analytics_session" ADD CONSTRAINT "analytics_session_site_id_analytics_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "analytics_site"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "analytics_site" ADD CONSTRAINT "analytics_site_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "analytics_site" ADD CONSTRAINT "analytics_site_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;