import type { AuditLogId } from "@otterdeploy/shared/id";

/**
 * Audit log — append-only, queryable compliance trail. One row per
 * audit-worthy RPC (mutations + every denial), populated from the evlog
 * audit pipeline via a Postgres drain (see `@otterdeploy/api` audit/pg-drain).
 *
 * Shape mirrors evlog's `AuditFields` (action / actor / target / outcome /
 * reason / changes / correlation) plus request context (ip / ua / requestId)
 * auto-filled by `auditEnricher`. Rows are never updated — `idempotencyKey`
 * is unique so retries across drains dedupe instead of duplicating.
 */
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";

export const auditActorTypeEnum = pgEnum("audit_actor_type", ["user", "system", "api", "agent"]);

export const auditOutcomeEnum = pgEnum("audit_outcome", ["success", "failure", "denied"]);

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id")
      .primaryKey()
      .$type<AuditLogId>()
      .$defaultFn(() => createId(ID_PREFIX.auditLog)),

    // Tenant scope. Nullable: pre-auth events (login, anonymous) have no org.
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),

    // When the action happened (event timestamp, not row-insert time).
    timestamp: timestamp("timestamp").notNull().defaultNow(),

    // What — `<resource>.<verb>` (e.g. "project.create", "git.connectPublicRepo").
    action: text("action").notNull(),

    // Who.
    actorType: auditActorTypeEnum("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    actorEmail: text("actor_email"),
    actorLabel: text("actor_label"),

    // On what (free-form resource ref).
    targetType: text("target_type"),
    targetId: text("target_id"),
    target: jsonb("target").$type<Record<string, unknown>>(),

    // Result.
    outcome: auditOutcomeEnum("outcome").notNull(),
    reason: text("reason"),
    durationMs: integer("duration_ms"),

    // Before/after diff for mutating actions (evlog `auditDiff`).
    changes: jsonb("changes").$type<Record<string, unknown>>(),

    // Request context (auto-filled by auditEnricher).
    requestId: text("request_id"),
    traceId: text("trace_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),

    // Chain related actions across one logical operation.
    correlationId: text("correlation_id"),
    causationId: text("causation_id"),

    // evlog audit envelope schema version.
    version: integer("version").notNull().default(1),

    // Stable hash from evlog `log.audit()` — dedupes retries across drains.
    idempotencyKey: text("idempotency_key"),

    // ═══ Tamper-resistance (od-5j8.21) ═══════════════════════════════════
    // Hash of the PREVIOUS chained row (see `../audit/chain.ts`). Every row
    // written through `insertChainedAuditRow` gets one — either a real
    // predecessor's `hash`, or the fixed genesis sentinel for the first
    // chained row ever written. Rows inserted before this feature shipped
    // have `prevHash`/`hash` both NULL — they predate the chain and are
    // simply not covered by verification (documented gap, not a bug).
    prevHash: text("prev_hash"),
    // sha256(prevHash || canonicalize(row)). Content-addressed: editing ANY
    // column of a chained row after the fact makes this recomputation not
    // match, and deleting a row breaks its successor's `prevHash` link.
    // `verifyAuditChain()` walks the table via these pointers (not
    // `createdAt`) so an attacker can't hide either kind of tampering by
    // also rewriting timestamps.
    hash: text("hash"),

    // ═══ Off-host export (od-5j8.21) ═════════════════════════════════════
    // Set once this row has been durably written to the configured external
    // export destination (see @otterdeploy/jobs audit-export). NULL = not
    // yet exported. The hourly retention purge (packages/jobs
    // jobs/hourly-cleanup.ts) still deletes on `timestamp` age alone — this
    // column only drives the export job's cursor, not deletion eligibility.
    exportedAt: timestamp("exported_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // Primary forensic query: an org's events, newest first.
    index("audit_log_org_ts_idx").on(t.organizationId, t.timestamp),
    index("audit_log_action_idx").on(t.action),
    index("audit_log_actor_idx").on(t.actorId),
    index("audit_log_outcome_idx").on(t.outcome),
    index("audit_log_target_idx").on(t.targetType, t.targetId),
    index("audit_log_correlation_idx").on(t.correlationId),
    // Append-only dedupe: same logical event never inserted twice.
    uniqueIndex("audit_log_idempotency_key_idx").on(t.idempotencyKey),
    // Every chained row's hash is unique by construction (content-addressed);
    // a duplicate would mean two rows hashed identically, which the
    // uniqueness constraint turns into a hard DB error instead of a silent
    // chain fork. Partial: legacy pre-chain rows all have `hash IS NULL`.
    uniqueIndex("audit_log_hash_idx").on(t.hash).where(sql`${t.hash} IS NOT NULL`),
    // Export job cursor: cheap "give me the oldest unexported rows" scan.
    index("audit_log_export_pending_idx").on(t.exportedAt, t.createdAt),
  ],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;

/**
 * Single-row chain checkpoint. `insertChainedAuditRow` locks THIS row
 * (`SELECT ... FOR UPDATE`) for the duration of its transaction, which is
 * what serializes concurrent writers into one total order — see
 * `../audit/chain.ts` for the full design rationale (why a single global
 * sequence rather than per-org chains or evlog's in-memory `signed()`
 * wrapper).
 */
export const auditChainState = pgTable("audit_chain_state", {
  // Fixed singleton row id — never anything else.
  id: text("id").primaryKey().default("singleton"),
  lastHash: text("last_hash"),
  lastRowId: text("last_row_id"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
