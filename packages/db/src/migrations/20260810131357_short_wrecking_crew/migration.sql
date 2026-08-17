CREATE TABLE "edge_threat_ip" (
	"host" text,
	"client_ip" text,
	"country" text,
	"probes" integer NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"sample_paths" text[] NOT NULL,
	CONSTRAINT "edge_threat_ip_pkey" PRIMARY KEY("host","client_ip")
);
--> statement-breakpoint
CREATE INDEX "edge_threat_ip_host_probes_idx" ON "edge_threat_ip" ("host","probes");--> statement-breakpoint
CREATE INDEX "edge_threat_ip_last_seen_idx" ON "edge_threat_ip" ("last_seen");