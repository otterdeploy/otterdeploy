/**
 * Hash-chain tamper-resistance for the audit trail (od-5j8.21).
 *
 * PROBLEM: `audit_log` is a normal table. Anyone with DB write access
 * (a superuser, a compromised backup-restore, a bug in an unrelated
 * migration) can silently `UPDATE` or `DELETE` a row and the UI would never
 * know — the whole point of an audit trail is defeated the moment its
 * storage isn't tamper-evident.
 *
 * DESIGN: every row inserted through `insertChainedAuditRow` carries
 * `prevHash` (the previous chained row's `hash`) and `hash` —
 * `sha256(prevHash + canonicalize(row))`. Content-addressing means editing
 * ANY column after the fact changes what `hash` should be, and deleting a
 * row breaks the `prevHash` pointer of whatever came after it. Both are
 * detected by `verifyAuditChain()`, which walks the table via the
 * `prevHash`→`hash` pointers themselves — never by `createdAt` — so an
 * attacker who also rewrites timestamps to hide a splice gains nothing.
 *
 * CONCURRENCY DECISION — one global serialized sequence, not per-org chains
 * or evlog's `signed({strategy:'hash-chain'})` wrapper:
 *
 *   - evlog ships a `signed()` drain wrapper that adds `prevHash`/`hash`
 *     using an in-memory (or caller-supplied load/save) tip. It was NOT
 *     used here: this control plane has multiple writers of audit rows in
 *     DIFFERENT PROCESSES — apps/server (oRPC via the pg-drain) AND
 *     apps/builder (deploy-completion system audits) — so an in-process tip
 *     cannot be the source of truth, and a load/save pair without a lock
 *     held across both steps is racy (two writers can load the same tip
 *     before either saves, forking the chain undetectably).
 *   - Per-org chains would avoid contention across tenants, but every
 *     verification, export, and "did anything get deleted" question would
 *     need to run once per org instead of once, and background/system rows
 *     (pre-auth, cross-org install-admin actions) have no org to chain
 *     under. Audit write volume here is low (mutations + denials only,
 *     already filtered upstream) — a single sequence's serialization cost
 *     is not a real bottleneck, so the simplicity of one chain (one
 *     verification pass, one export cursor) wins.
 *   - Periodic checkpoint anchoring (e.g. merkle-root every N rows,
 *     published somewhere external) is a genuinely good complementary
 *     defense against a FULL database compromise that rewrites the entire
 *     chain self-consistently — a hash chain alone can't catch that, only
 *     an independent copy can (see od-5j8.21 export, `../../../jobs/src/
 *     audit-export`). Anchoring is not implemented here; the off-host
 *     export IS the anchor for now (compare the DB's tail against the last
 *     exported batch to catch a full rewrite). Documented as the natural
 *     next step rather than built speculatively.
 *
 * The serialization primitive is a single-row lock: `insertChainedAuditRow`
 * runs inside a transaction that `SELECT ... FOR UPDATE`s the singleton
 * `audit_chain_state` row before reading the current tip. Postgres blocks
 * every concurrent chain-writer (any process, any org) on that row lock
 * until the holder commits, which is exactly "one global serialized
 * sequence" — and it is real DB-level serialization, not an
 * application-level mutex that only helps within one process.
 */
import type { AuditLogId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { auditChainState, auditLog } from "@otterdeploy/db/schema";
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { eq, isNotNull } from "drizzle-orm";
import { createHash } from "node:crypto";

/**
 * Fixed sentinel used as `prevHash` for the very first row this chain ever
 * writes. A real predecessor's `hash` is a sha256 hex digest (64 lowercase
 * hex chars) — this deliberately isn't one, so it can never collide with a
 * legitimate hash.
 */
export const CHAIN_GENESIS = "otterdeploy-audit-chain-genesis-v1";

const CHAIN_STATE_ID = "singleton";

export type AuditActorType = "user" | "system" | "api" | "agent";
export type AuditOutcome = "success" | "failure" | "denied";

/** Content columns a chained row hashes over. Deliberately excludes
 *  `prevHash`/`hash` (chain metadata, not content) and `exportedAt` (set
 *  later, by a different process, and must not change a row's hash after
 *  the fact — export status isn't part of what happened, only bookkeeping
 *  about the trail itself). */
export interface ChainableAuditRow {
  id: AuditLogId;
  organizationId: string | null;
  timestamp: Date;
  action: string;
  actorType: AuditActorType;
  actorId: string;
  actorEmail: string | null;
  actorLabel: string | null;
  targetType: string | null;
  targetId: string | null;
  target: Record<string, unknown> | null;
  outcome: AuditOutcome;
  reason: string | null;
  durationMs: number | null;
  changes: Record<string, unknown> | null;
  requestId: string | null;
  traceId: string | null;
  ip: string | null;
  userAgent: string | null;
  correlationId: string | null;
  causationId: string | null;
  version: number;
  idempotencyKey: string | null;
  createdAt: Date;
}

/** Deterministic JSON: object keys sorted recursively, arrays keep order.
 *  Two logically-identical rows always canonicalize to the same string
 *  regardless of property insertion order, so the hash is stable across
 *  drains/processes. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** `sha256(prevHash + "\n" + canonicalize(row))`, hex-encoded. */
export function computeRowHash(prevHash: string, row: ChainableAuditRow): string {
  return createHash("sha256").update(prevHash).update("\n").update(canonicalJson(row)).digest("hex");
}

export type NewChainableAuditRow = Omit<ChainableAuditRow, "id" | "createdAt"> &
  Partial<Pick<ChainableAuditRow, "id" | "createdAt">>;

/**
 * Append one row to the tamper-evident chain. Safe to call concurrently
 * from any process — see module doc for the locking design. A dedupe
 * conflict on `idempotencyKey` (the same logical event delivered twice) is a
 * no-op: no new row, and the chain tip does not advance, because nothing
 * new actually happened.
 */
export async function insertChainedAuditRow(
  input: NewChainableAuditRow,
): Promise<{ id: string; hash: string } | null> {
  // `auditLog.id` is a branded `AuditLogId` in the schema; every real caller
  // lets this generate one (createId already returns the branded type), so
  // the cast here only matters for the type checker, not runtime behavior —
  // a caller-supplied `input.id` is always a plain string in practice (none
  // of the three call sites pass one).
  const id = (input.id ?? createId(ID_PREFIX.auditLog)) as AuditLogId;
  const createdAt = input.createdAt ?? new Date();
  const row: ChainableAuditRow = { ...input, id, createdAt };

  return db.transaction(async (tx) => {
    // Ensure the singleton exists (idempotent — a fresh DB has none yet).
    await tx.insert(auditChainState).values({ id: CHAIN_STATE_ID }).onConflictDoNothing();

    // Locks the ONE row every concurrent chain-writer contends on. Every
    // other transaction calling insertChainedAuditRow blocks here until
    // this one commits or rolls back — the serialization point.
    const [state] = await tx
      .select({ lastHash: auditChainState.lastHash })
      .from(auditChainState)
      .where(eq(auditChainState.id, CHAIN_STATE_ID))
      .for("update");

    const prevHash = state?.lastHash ?? CHAIN_GENESIS;
    const hash = computeRowHash(prevHash, row);

    const [inserted] = await tx
      .insert(auditLog)
      .values({ ...row, prevHash, hash })
      .onConflictDoNothing()
      .returning({ id: auditLog.id });

    // A dedupe hit inserted nothing — the chain didn't grow, so the tip
    // must not move either (a state advance with no matching row would
    // itself look like tampering to verifyAuditChain).
    if (!inserted) return null;

    await tx
      .insert(auditChainState)
      .values({ id: CHAIN_STATE_ID, lastHash: hash, lastRowId: id, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: auditChainState.id,
        set: { lastHash: hash, lastRowId: id, updatedAt: new Date() },
      });

    return { id, hash };
  });
}

// ── Verification ────────────────────────────────────────────────────────

export type ChainBreakReason =
  | "hash-mismatch" // row content doesn't hash to its stored `hash` — modified.
  | "missing-predecessor" // prevHash doesn't match any known row's hash — deleted/spliced.
  | "duplicate-successor" // two rows claim the same prevHash — forked/replayed.
  | "multiple-genesis"; // more than one row claims to start the chain.

export interface ChainBreak {
  reason: ChainBreakReason;
  rowId: string;
  detail: string;
}

export interface VerifyChainResult {
  ok: boolean;
  /** Number of chained rows examined (hash IS NOT NULL). Legacy pre-chain
   *  rows (hash IS NULL) are outside the chain by construction and are not
   *  counted — see the schema comment on `auditLog.prevHash`. */
  checked: number;
  /** First break encountered, in chain order — fix this one first. */
  firstBreak: ChainBreak | null;
}

/**
 * Walk the whole chain via its `prevHash`→`hash` pointers (not timestamps)
 * and report the FIRST broken link. Cheap enough to run on demand or on a
 * schedule: one full-table read of the (small, indexed) chain columns, then
 * an in-memory walk — no per-row query.
 *
 * Limitation, by design of any hash chain: an attacker with full DB write
 * access who rewrites the ENTIRE table self-consistently (recomputing every
 * hash after their edit) produces a chain that verifies cleanly. Catching
 * that requires an independent copy of the tail — the off-host export
 * (`@otterdeploy/jobs` audit-export) exists for exactly this; compare its
 * last exported batch's hashes against the live chain to catch a full
 * rewrite that only touches rows written after the last export.
 */
export async function verifyAuditChain(): Promise<VerifyChainResult> {
  const rows = await db
    .select({
      id: auditLog.id,
      organizationId: auditLog.organizationId,
      timestamp: auditLog.timestamp,
      action: auditLog.action,
      actorType: auditLog.actorType,
      actorId: auditLog.actorId,
      actorEmail: auditLog.actorEmail,
      actorLabel: auditLog.actorLabel,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      target: auditLog.target,
      outcome: auditLog.outcome,
      reason: auditLog.reason,
      durationMs: auditLog.durationMs,
      changes: auditLog.changes,
      requestId: auditLog.requestId,
      traceId: auditLog.traceId,
      ip: auditLog.ip,
      userAgent: auditLog.userAgent,
      correlationId: auditLog.correlationId,
      causationId: auditLog.causationId,
      version: auditLog.version,
      idempotencyKey: auditLog.idempotencyKey,
      createdAt: auditLog.createdAt,
      prevHash: auditLog.prevHash,
      hash: auditLog.hash,
    })
    .from(auditLog)
    .where(isNotNull(auditLog.hash));

  if (rows.length === 0) return { ok: true, checked: 0, firstBreak: null };

  const byHash = new Map<string, (typeof rows)[number]>();
  const bySuccessorOfPrevHash = new Map<string, (typeof rows)[number][]>();
  const genesisRows: (typeof rows)[number][] = [];

  for (const row of rows) {
    if (row.hash) byHash.set(row.hash, row);
    const prev = row.prevHash ?? CHAIN_GENESIS;
    if (prev === CHAIN_GENESIS) genesisRows.push(row);
    const bucket = bySuccessorOfPrevHash.get(prev) ?? [];
    bucket.push(row);
    bySuccessorOfPrevHash.set(prev, bucket);
  }

  // Duplicate successors (two rows pointing at the same predecessor,
  // including two independent genesis rows) are forks — report the first
  // one found, in row-array order (arbitrary but deterministic per query).
  for (const [prev, successors] of bySuccessorOfPrevHash) {
    if (successors.length > 1) {
      const [first, second] = successors;
      return {
        ok: false,
        checked: rows.length,
        firstBreak: {
          reason: prev === CHAIN_GENESIS ? "multiple-genesis" : "duplicate-successor",
          rowId: second?.id ?? first?.id ?? "unknown",
          detail:
            prev === CHAIN_GENESIS
              ? `${successors.length} rows claim to be the chain's genesis`
              : `${successors.length} rows claim prevHash=${prev.slice(0, 12)}…`,
        },
      };
    }
  }

  if (genesisRows.length === 0) {
    // Every chained row claims a predecessor, but none is the genesis —
    // the true start of the chain was deleted.
    const [first] = rows;
    return {
      ok: false,
      checked: rows.length,
      firstBreak: {
        reason: "missing-predecessor",
        rowId: first?.id ?? "unknown",
        detail: "no row claims the genesis prevHash — the chain's first row is missing",
      },
    };
  }

  // Walk forward from genesis, recomputing each row's hash as we go.
  // Explicitly `| undefined`: the walk ends when a link has no successor, and
  // under noUncheckedIndexedAccess an array index is undefined-able anyway.
  let current: (typeof genesisRows)[number] | undefined = genesisRows[0];
  let expectedPrev = CHAIN_GENESIS;
  let visited = 0;
  while (current) {
    const recomputed = computeRowHash(expectedPrev, {
      id: current.id,
      organizationId: current.organizationId,
      timestamp: current.timestamp,
      action: current.action,
      actorType: current.actorType,
      actorId: current.actorId,
      actorEmail: current.actorEmail,
      actorLabel: current.actorLabel,
      targetType: current.targetType,
      targetId: current.targetId,
      target: current.target,
      outcome: current.outcome,
      reason: current.reason,
      durationMs: current.durationMs,
      changes: current.changes,
      requestId: current.requestId,
      traceId: current.traceId,
      ip: current.ip,
      userAgent: current.userAgent,
      correlationId: current.correlationId,
      causationId: current.causationId,
      version: current.version,
      idempotencyKey: current.idempotencyKey,
      createdAt: current.createdAt,
    });
    if (recomputed !== current.hash) {
      return {
        ok: false,
        checked: rows.length,
        firstBreak: {
          reason: "hash-mismatch",
          rowId: current.id,
          detail: `stored hash does not match recomputed content hash — row was modified after being written`,
        },
      };
    }
    visited += 1;
    expectedPrev = current.hash as string;
    const successors = bySuccessorOfPrevHash.get(current.hash as string);
    current = successors?.[0];
  }

  if (visited < rows.length) {
    // Some chained rows exist but were never reached walking from genesis —
    // their predecessor is missing (deleted), stranding them off-chain.
    const reached = new Set<string>();
    let walker: (typeof genesisRows)[number] | undefined = genesisRows[0];
    let prevForWalk = CHAIN_GENESIS;
    while (walker) {
      reached.add(walker.id);
      prevForWalk = walker.hash as string;
      walker = bySuccessorOfPrevHash.get(prevForWalk)?.[0];
    }
    const orphan = rows.find((r) => !reached.has(r.id));
    return {
      ok: false,
      checked: rows.length,
      firstBreak: {
        reason: "missing-predecessor",
        rowId: orphan?.id ?? "unknown",
        detail: `row's predecessor is missing from the chain (deleted) — ${rows.length - visited} row(s) stranded`,
      },
    };
  }

  return { ok: true, checked: rows.length, firstBreak: null };
}
