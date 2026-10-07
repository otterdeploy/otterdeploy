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

import type { ResolvedActor } from "../../authz/actor";

import { authorizeCapability } from "../../authz/capability";
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
 * Which audit rows a caller may read: their own organization's, and — for an
 * installation administrator only — the rows that belong to no organization.
 *
 * A NULL organization is not "nobody's data". Those rows are the failed
 * sign-ins against an address with no account (the typed email, the caller's
 * IP and user agent) and every auth/org-gate denial written before a tenant
 * resolved, which includes signed-in users of OTHER organizations hitting a
 * gate. Unioning them into every org's feed would hand each tenant's members
 * the install-wide failure log. They are install-level records, so they need
 * install authority, the same boundary `requireInstallAdmin` enforces (an
 * organization API key never carries it, whatever its scope).
 *
 * Shared by the feed and the legacy `list`/`distinct` reads in ./index.ts, so
 * the two read paths cannot disagree about who sees what.
 */
export async function auditScope(actor: ResolvedActor, orgId: string): Promise<SQL> {
  const ownOrg = eq(auditLog.organizationId, orgId);
  const install = await authorizeCapability(actor, { scope: "install", mode: "read" });
  if (!install.allowed) return ownOrg;
  return or(ownOrg, isNull(auditLog.organizationId)) ?? ownOrg;
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

/** `scope` is the caller's {@link auditScope}: composed outside the filters. */
export async function runAuditFeed(input: AuditFeedInput, scope: SQL) {
  // Untrusted input, validated against the declaration rather than trusted:
  // unknown keys dropped, enum members checked against the declared set,
  // numeric ranges clamped to their declared bounds.
  const values = auditFilters.coerce(input.filters);

  const page = await feed.execute({
    values,
    scope: [scope],
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
