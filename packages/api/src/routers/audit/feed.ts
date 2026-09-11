/**
 * The audit feed.
 *
 * The whole read path for the audit page: the three-pass WHERE, the counts, the
 * facets, one cursor page, and a histogram over the same filtered set — all
 * driven by the single declaration in `table.ts`, which the client filters
 * with too.
 *
 * The org scope is composed OUTSIDE the filter path. No filter value, however
 * malformed or hand-edited into a URL, can widen this query past the caller's
 * organization — which matters more here than anywhere else in the product,
 * because this table is the record of who did what.
 */

import { db } from "@otterdeploy/db";
import { auditLog } from "@otterdeploy/db/schema";
import { isJsonObject, type JsonObject } from "@otterdeploy/shared/json";
import { eq, isNull, or, type SQL } from "drizzle-orm";

import { createFeedHandler, feedResponse } from "../../lib/table";
import { auditColumnMap, auditExtraSelect, auditFilters } from "./table";

type AuditRow = typeof auditLog.$inferSelect;

/**
 * Construction is where an unmapped filter column throws.
 *
 * A declared-but-unmapped column would otherwise stop filtering silently, and
 * a filter that quietly matches everything is a security-shaped bug on an audit
 * log specifically.
 */
const feed = createFeedHandler({
  db,
  table: auditLog,
  filters: auditFilters,
  columns: auditColumnMap,
  select: auditExtraSelect,
  cursorKey: "at",
  defaultSize: 50,
});

/**
 * Org scope for the feed.
 *
 * Rows with a NULL organization are included deliberately: every DENIED row
 * from an auth or org gate is written before an organization is known, so an
 * org-only predicate makes the denied count permanently zero. Those rows belong
 * to no tenant by construction, so surfacing them leaks nothing — and they are
 * the only way an operator ever sees "someone was blocked before establishing
 * identity".
 */
function orgScope(orgId: string): SQL[] {
  const scope = or(eq(auditLog.organizationId, orgId), isNull(auditLog.organizationId));
  return scope ? [scope] : [];
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A guard, not a cast: a jsonb column can hold an array or a scalar too. */
function asJsonObject(value: unknown): JsonObject | null {
  return isJsonObject(value) ? value : null;
}

/** The projection erases the column's enum type; these put it back honestly. */
function toOutcome(value: unknown): AuditRow["outcome"] {
  return value === "failure" || value === "denied" ? value : "success";
}

function toActorType(value: unknown): AuditRow["actorType"] {
  return value === "system" || value === "api" || value === "agent" ? value : "user";
}

function toEpochMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  return typeof value === "number" ? value : Number.NaN;
}

/** One row, keyed the way the client's columns are. */
function toFeedRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    at: toEpochMs(row.at),
    action: String(row.action),
    outcome: toOutcome(row.outcome),
    actorType: toActorType(row.actorType),
    actorId: String(row.actorId),
    actor: asNullableString(row.actor),
    actorLabel: asNullableString(row.actorLabel),
    targetType: asNullableString(row.targetType),
    targetId: asNullableString(row.targetId),
    target: asJsonObject(row.target),
    reason: asNullableString(row.reason),
    durationMs: typeof row.durationMs === "number" ? row.durationMs : null,
    changes: asJsonObject(row.changes),
    ip: asNullableString(row.ip),
    userAgent: asNullableString(row.userAgent),
    correlationId: asNullableString(row.correlationId),
    causationId: asNullableString(row.causationId),
  };
}

export interface AuditFeedInput {
  filters: Record<string, unknown>;
  sort?: { key: string; desc: boolean } | null;
  cursor?: number | null;
  direction: "next" | "prev";
  size: number;
  includeFacets: boolean;
  timeZone?: string;
}

export async function runAuditFeed(input: AuditFeedInput, orgId: string) {
  // Untrusted input, validated against the declaration rather than trusted:
  // unknown keys dropped, enum members checked against the declared set,
  // numeric ranges clamped to their declared bounds.
  const values = auditFilters.coerce(input.filters);

  const page = await feed.execute({
    values,
    scope: orgScope(orgId),
    sort: input.sort ?? null,
    cursor: input.cursor ?? null,
    direction: input.direction,
    size: input.size,
    includeFacets: input.includeFacets,
  });

  const response = await feedResponse(page, {
    db,
    table: auditLog,
    timeColumn: auditLog.timestamp,
    categoryColumn: auditLog.outcome,
    includeFacets: input.includeFacets,
    toItem: toFeedRow,
  });

  return response;
}
