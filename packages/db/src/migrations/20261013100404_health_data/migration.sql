CREATE SEQUENCE "public"."health_ledger_rec" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "health_batch" (
	"source_node_id" text,
	"batch_id" text,
	"received_at" bigint NOT NULL,
	CONSTRAINT "health_batch_pkey" PRIMARY KEY("source_node_id","batch_id")
);
--> statement-breakpoint
CREATE TABLE "health_boot" (
	"id" bigserial PRIMARY KEY,
	"source_node_id" text NOT NULL,
	"node_epoch" bigint NOT NULL,
	"boot_id" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_counters" (
	"k" text PRIMARY KEY,
	"v" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_ledger_anchor" (
	"series_id" bigint PRIMARY KEY,
	"t" bigint NOT NULL,
	"boot" bigint NOT NULL,
	"seq" bigint NOT NULL,
	"kind" smallint NOT NULL,
	"state" smallint NOT NULL,
	"unc_ms" integer NOT NULL,
	"ttl_ms" integer NOT NULL,
	"lat_us" integer,
	"att_us" integer[],
	"vals" real[]
);
--> statement-breakpoint
CREATE TABLE "health_meta" (
	"k" text PRIMARY KEY,
	"v" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_probe_r1d" (
	"series_id" bigint,
	"bucket" bigint,
	"ver" integer NOT NULL,
	"ledger_hw" bigint NOT NULL,
	"eval_rev" smallint NOT NULL,
	"complete" boolean NOT NULL,
	"dur_ms" integer[] NOT NULL,
	"n" integer NOT NULL,
	"sketch" bytea,
	"att_sketch" bytea,
	"bdigest" bytea NOT NULL,
	CONSTRAINT "health_probe_r1d_pkey" PRIMARY KEY("series_id","bucket")
);
--> statement-breakpoint
CREATE TABLE "health_rebuild_pending" (
	"id" bigserial PRIMARY KEY,
	"series_id" bigint NOT NULL,
	"lo" bigint NOT NULL,
	"hi" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_rejected" (
	"id" bigserial PRIMARY KEY,
	"series_id" bigint,
	"t" bigint NOT NULL,
	"boot" bigint NOT NULL,
	"seq" bigint NOT NULL,
	"reason" smallint NOT NULL,
	"received_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_series" (
	"id" bigserial PRIMARY KEY,
	"organization_id" text NOT NULL,
	"kind" smallint NOT NULL,
	"source_node_id" text NOT NULL,
	"identity_key" text NOT NULL,
	"subject_id" text NOT NULL,
	"dimension_set" text,
	"check_id" text,
	"check_revision" integer,
	"node_dimension" boolean NOT NULL,
	"max_ttl_ms" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "health_batch_received_idx" ON "health_batch" ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "health_boot_identity" ON "health_boot" ("source_node_id","node_epoch","boot_id");--> statement-breakpoint
CREATE INDEX "health_rebuild_pending_series_idx" ON "health_rebuild_pending" ("series_id");--> statement-breakpoint
CREATE INDEX "health_rejected_received_idx" ON "health_rejected" ("received_at");--> statement-breakpoint
CREATE INDEX "health_rejected_series_idx" ON "health_rejected" ("series_id");--> statement-breakpoint
CREATE UNIQUE INDEX "health_series_identity_key" ON "health_series" ("identity_key");--> statement-breakpoint
CREATE INDEX "health_series_org_idx" ON "health_series" ("organization_id");--> statement-breakpoint
CREATE INDEX "health_series_source_idx" ON "health_series" ("source_node_id","subject_id");--> statement-breakpoint
CREATE INDEX "health_series_check_idx" ON "health_series" ("organization_id","check_id");--> statement-breakpoint
ALTER TABLE "health_ledger_anchor" ADD CONSTRAINT "health_ledger_anchor_series_id_health_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "health_series"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "health_probe_r1d" ADD CONSTRAINT "health_probe_r1d_series_id_health_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "health_series"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "health_rebuild_pending" ADD CONSTRAINT "health_rebuild_pending_series_id_health_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "health_series"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "health_rejected" ADD CONSTRAINT "health_rejected_series_id_health_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "health_series"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "health_series" ADD CONSTRAINT "health_series_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
-- Hand-written below this line: the RANGE-partitioned health tables, which
-- drizzle-kit cannot express (excluded from it by tablesFilter in
-- drizzle.config.ts; typed in packages/db/src/schema/health-data-partitioned.ts).
-- Each references health_series ON DELETE CASCADE: a foreign key FROM a
-- partitioned table is supported since PostgreSQL 11 and is inherited by
-- every partition, so deleting an organization reaches all of its rows.
-- Only the parents are created here. Child partitions are created ahead and
-- dropped by packages/api/src/health-data/partitions.ts, so retention is a
-- partition drop, never a bulk DELETE. Every partition key is epoch ms.
CREATE TABLE "health_probe_raw" (
	"series_id" bigint NOT NULL REFERENCES "health_series"("id") ON DELETE CASCADE,
	"t" bigint NOT NULL,
	"boot" bigint NOT NULL,
	"seq" bigint NOT NULL,
	"round" bigint NOT NULL,
	"state" smallint NOT NULL,
	"outcome" smallint NOT NULL,
	"cause" smallint NOT NULL,
	"lat_us" integer,
	"att_us" integer[],
	"unc_ms" integer NOT NULL,
	"received_at" bigint NOT NULL,
	"live" boolean NOT NULL,
	"detail" jsonb
) PARTITION BY RANGE ("t");--> statement-breakpoint
CREATE INDEX "health_probe_raw_series_t" ON "health_probe_raw" ("series_id","t");--> statement-breakpoint
CREATE TABLE "health_metric_raw" (
	"series_id" bigint NOT NULL REFERENCES "health_series"("id") ON DELETE CASCADE,
	"t" bigint NOT NULL,
	"boot" bigint NOT NULL,
	"seq" bigint NOT NULL,
	"unc_ms" integer NOT NULL,
	"received_at" bigint NOT NULL,
	"live" boolean NOT NULL,
	"vals" real[] NOT NULL
) PARTITION BY RANGE ("t");--> statement-breakpoint
CREATE INDEX "health_metric_raw_series_t" ON "health_metric_raw" ("series_id","t");--> statement-breakpoint
CREATE TABLE "health_ledger" (
	"series_id" bigint NOT NULL REFERENCES "health_series"("id") ON DELETE CASCADE,
	"t" bigint NOT NULL,
	"boot" bigint NOT NULL,
	"seq" bigint NOT NULL,
	"kind" smallint NOT NULL,
	"state" smallint NOT NULL,
	"unc_ms" integer NOT NULL,
	"ttl_ms" integer NOT NULL,
	"lat_us" integer,
	"att_us" integer[],
	"vals" real[],
	"digest" bytea NOT NULL,
	"rec_id" bigint DEFAULT nextval('health_ledger_rec') NOT NULL,
	CONSTRAINT "health_ledger_pkey" PRIMARY KEY("series_id","t","boot","seq")
) PARTITION BY RANGE ("t");--> statement-breakpoint
CREATE INDEX "health_ledger_identity" ON "health_ledger" ("series_id","boot","seq");--> statement-breakpoint
CREATE TABLE "health_probe_r10m" (
	"series_id" bigint NOT NULL REFERENCES "health_series"("id") ON DELETE CASCADE,
	"bucket" bigint NOT NULL,
	"ver" integer NOT NULL,
	"ledger_hw" bigint NOT NULL,
	"eval_rev" smallint NOT NULL,
	"complete" boolean NOT NULL,
	"dur_ms" integer[] NOT NULL,
	"n" integer NOT NULL,
	"sketch" bytea,
	"att_sketch" bytea,
	"bdigest" bytea NOT NULL,
	CONSTRAINT "health_probe_r10m_pkey" PRIMARY KEY("series_id","bucket")
) PARTITION BY RANGE ("bucket");--> statement-breakpoint
CREATE TABLE "health_probe_r1h" (LIKE "health_probe_r10m" INCLUDING DEFAULTS, CONSTRAINT "health_probe_r1h_pkey" PRIMARY KEY("series_id","bucket")) PARTITION BY RANGE ("bucket");--> statement-breakpoint
ALTER TABLE "health_probe_r1h" ADD CONSTRAINT "health_probe_r1h_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "health_series"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE TABLE "health_metric_r10m" (
	"series_id" bigint NOT NULL REFERENCES "health_series"("id") ON DELETE CASCADE,
	"bucket" bigint NOT NULL,
	"ver" integer NOT NULL,
	"ledger_hw" bigint NOT NULL,
	"eval_rev" smallint NOT NULL,
	"complete" boolean NOT NULL,
	"n" integer NOT NULL,
	"cov_ms" integer NOT NULL,
	"mean" real[] NOT NULL,
	"max" real[] NOT NULL,
	"cnt" integer[] NOT NULL,
	"bdigest" bytea NOT NULL,
	CONSTRAINT "health_metric_r10m_pkey" PRIMARY KEY("series_id","bucket")
) PARTITION BY RANGE ("bucket");--> statement-breakpoint
CREATE TABLE "health_metric_r1h" (LIKE "health_metric_r10m" INCLUDING DEFAULTS, CONSTRAINT "health_metric_r1h_pkey" PRIMARY KEY("series_id","bucket")) PARTITION BY RANGE ("bucket");--> statement-breakpoint
ALTER TABLE "health_metric_r1h" ADD CONSTRAINT "health_metric_r1h_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "health_series"("id") ON DELETE CASCADE;
--> statement-breakpoint
-- The advertised horizons exist from the start: ingest reads them FOR SHARE
-- inside its transaction, and retention's publish (an UPDATE of these rows)
-- must always have rows to conflict with. 0 = nothing expired yet.
INSERT INTO "health_meta" ("k", "v") VALUES ('horizon_ms', 0), ('raw_horizon_ms', 0) ON CONFLICT DO NOTHING;
