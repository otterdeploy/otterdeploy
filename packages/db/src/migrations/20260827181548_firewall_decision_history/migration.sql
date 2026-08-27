CREATE TABLE "firewall_decision" (
	"id" text PRIMARY KEY,
	"lapi_id" integer,
	"value" text NOT NULL,
	"scope" text NOT NULL,
	"type" text NOT NULL,
	"scenario" text NOT NULL,
	"origin" text NOT NULL,
	"duration" text,
	"country" text,
	"as_number" text,
	"as_name" text,
	"events_count" integer,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "firewall_decision_lapi_id_unique" ON "firewall_decision" ("lapi_id") WHERE lapi_id is not null;--> statement-breakpoint
CREATE INDEX "firewall_decision_value_idx" ON "firewall_decision" ("value");--> statement-breakpoint
CREATE INDEX "firewall_decision_ended_at_idx" ON "firewall_decision" ("ended_at","last_seen_at");