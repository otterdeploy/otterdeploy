CREATE TABLE "otterd_authority" (
	"install_id" text PRIMARY KEY,
	"authority_term" integer NOT NULL,
	"anchor_seq" integer,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otterd_command" (
	"op_id" text PRIMARY KEY,
	"node_id" text NOT NULL,
	"verb" text NOT NULL,
	"payload_hash" text NOT NULL,
	"grant_id" text,
	"operation_epoch" integer NOT NULL,
	"state" text NOT NULL,
	"outcome" jsonb,
	"sent_at" bigint NOT NULL,
	"answered_at" bigint
);
--> statement-breakpoint
CREATE TABLE "otterd_decision" (
	"id" bigserial PRIMARY KEY,
	"at" bigint NOT NULL,
	"kind" text NOT NULL,
	"resource_id" text,
	"slot_index" integer,
	"node_id" text,
	"grant_id" text,
	"detail" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otterd_enroll_token" (
	"token_id" text PRIMARY KEY,
	"token_hash" text NOT NULL UNIQUE,
	"roles" jsonb NOT NULL,
	"labels" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"used_at" bigint,
	"used_by_node" text
);
--> statement-breakpoint
CREATE TABLE "otterd_evidence" (
	"evidence_id" text PRIMARY KEY,
	"kind" text NOT NULL,
	"node_id" text NOT NULL,
	"node_epoch" integer NOT NULL,
	"grant_id" text,
	"document" jsonb NOT NULL,
	"observed_at" bigint NOT NULL,
	"recorded_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otterd_fence" (
	"id" bigserial PRIMARY KEY,
	"node_id" text NOT NULL,
	"node_epoch" integer NOT NULL,
	"adapter" text NOT NULL,
	"revoked_at" bigint NOT NULL,
	"requested_at" bigint NOT NULL,
	"state" text NOT NULL,
	"evidence_id" text,
	"error" text,
	"finished_at" bigint
);
--> statement-breakpoint
CREATE TABLE "otterd_grant" (
	"grant_id" text PRIMARY KEY,
	"resource_id" text NOT NULL,
	"slot_index" integer NOT NULL,
	"generation" integer NOT NULL,
	"authority_term" integer NOT NULL,
	"node_id" text NOT NULL,
	"node_epoch" integer NOT NULL,
	"incarnation" text NOT NULL,
	"exclusive" boolean NOT NULL,
	"spec_revision" integer NOT NULL,
	"state" text NOT NULL,
	"orphan" boolean DEFAULT false NOT NULL,
	"surge" boolean DEFAULT false NOT NULL,
	"operation_epoch" integer NOT NULL,
	"op_id" text NOT NULL,
	"revoked_at" bigint,
	"stop_requested_at" bigint,
	"sent_at" bigint,
	"released_at" bigint,
	"release_evidence_id" text,
	"attempts" jsonb DEFAULT '[]' NOT NULL,
	"running_since" bigint,
	"failed" boolean DEFAULT false NOT NULL,
	"held_attempt" text,
	"adopts_attempt" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otterd_node" (
	"node_id" text PRIMARY KEY,
	"ordinal" integer NOT NULL,
	"node_epoch" integer NOT NULL,
	"key_epoch" integer NOT NULL,
	"identity_key" text NOT NULL,
	"identity_key_id" text NOT NULL,
	"roles" jsonb NOT NULL,
	"labels" jsonb NOT NULL,
	"arch" text NOT NULL,
	"host" jsonb NOT NULL,
	"facts" jsonb NOT NULL,
	"allocatable_nano_cpus" bigint NOT NULL,
	"allocatable_memory_bytes" bigint NOT NULL,
	"admin" text DEFAULT 'active' NOT NULL,
	"anchor_seq" integer,
	"fence_adapter" text,
	"fence_enabled" boolean DEFAULT false NOT NULL,
	"fence_binding" jsonb,
	"last_evidence_at" bigint,
	"session_id" text,
	"incarnation" text,
	"boot_id" text,
	"reported_session" text,
	"peer_fresh_until" bigint,
	"upgrade_phase" text,
	"upgrade_from_incarnation" text,
	"upgrade_since" bigint,
	"enrolled_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otterd_service" (
	"resource_id" text PRIMARY KEY,
	"revision" integer NOT NULL,
	"stable_revision" integer,
	"paused" boolean DEFAULT false NOT NULL,
	"home_node" text,
	"rollout_paused" boolean DEFAULT false NOT NULL,
	"last_slot_updated_at" bigint,
	"operation_epoch" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otterd_service_revision" (
	"resource_id" text,
	"revision" integer,
	"spec" jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "otterd_service_revision_pkey" PRIMARY KEY("resource_id","revision")
);
--> statement-breakpoint
CREATE TABLE "otterd_slot" (
	"resource_id" text,
	"slot_index" integer,
	"generation_high_water" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "otterd_slot_pkey" PRIMARY KEY("resource_id","slot_index")
);
--> statement-breakpoint
CREATE INDEX "otterd_command_grant" ON "otterd_command" ("grant_id");--> statement-breakpoint
CREATE INDEX "otterd_decision_resource" ON "otterd_decision" ("resource_id","at");--> statement-breakpoint
CREATE INDEX "otterd_decision_node" ON "otterd_decision" ("node_id","at");--> statement-breakpoint
CREATE INDEX "otterd_evidence_node" ON "otterd_evidence" ("node_id","node_epoch");--> statement-breakpoint
CREATE UNIQUE INDEX "otterd_evidence_grant" ON "otterd_evidence" ("grant_id") WHERE "grant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "otterd_fence_in_flight" ON "otterd_fence" ("node_id","node_epoch") WHERE "state" = 'requested';--> statement-breakpoint
CREATE UNIQUE INDEX "otterd_grant_slot_generation" ON "otterd_grant" ("resource_id","slot_index","generation");--> statement-breakpoint
CREATE UNIQUE INDEX "otterd_grant_one_live_exclusive" ON "otterd_grant" ("resource_id","slot_index") WHERE "exclusive" and "state" <> 'released';--> statement-breakpoint
CREATE INDEX "otterd_grant_live_by_node" ON "otterd_grant" ("node_id") WHERE "state" <> 'released';--> statement-breakpoint
CREATE UNIQUE INDEX "otterd_node_ordinal" ON "otterd_node" ("ordinal");--> statement-breakpoint
ALTER TABLE "otterd_grant" ADD CONSTRAINT "otterd_grant_node_id_otterd_node_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "otterd_node"("node_id");--> statement-breakpoint
ALTER TABLE "otterd_service_revision" ADD CONSTRAINT "otterd_service_revision_KwnlpfqKkoxP_fkey" FOREIGN KEY ("resource_id") REFERENCES "otterd_service"("resource_id") ON DELETE CASCADE;