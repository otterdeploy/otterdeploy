/**
 * What the audit feed can be filtered by — declared once, on the server.
 *
 * The client imports these specs to build its controls, and the handler
 * compiles the very same declarations into SQL. That is the whole point: a
 * filter cannot mean one thing in the sidebar and another in the WHERE clause,
 * and a column that is not declared here cannot be filtered on from anywhere.
 */

import { auditLog } from "@otterdeploy/db/schema";
import { defineFilters, type FilterSpec } from "@otterdeploy/shared/table-filters";

import type { ColumnMap } from "../../lib/table";

/** Outcomes, in the order they matter to someone reading a security feed. */
const AUDIT_OUTCOMES = ["denied", "failure", "success"] as const;
const AUDIT_ACTOR_TYPES = ["user", "system", "api", "agent"] as const;

export const auditFilterSpecs: readonly FilterSpec[] = [
  { key: "at", type: "timerange", kind: "instant" },
  { key: "outcome", type: "checkbox", kind: "enum", options: [...AUDIT_OUTCOMES] },
  { key: "action", type: "checkbox", kind: "string" },
  { key: "actorType", type: "checkbox", kind: "enum", options: [...AUDIT_ACTOR_TYPES] },
  { key: "actor", type: "checkbox", kind: "string" },
  { key: "targetType", type: "checkbox", kind: "string" },
  {
    // One box over the columns an operator actually gropes for an id in.
    key: "q",
    type: "search",
    kind: "string",
    keys: ["action", "actor", "actorId", "targetId", "reason"],
  },
];

export const auditFilters = defineFilters(auditFilterSpecs);

/**
 * Filter key → column. Also the projection, so rows come back keyed by these
 * names and nothing maintains an inverse mapping.
 *
 * `actor` is the email rather than the id: a filter list of opaque ids is not a
 * filter list anyone can use. Actors with no email (system, api) are reachable
 * through `actorType` and the search box, and their rows still count toward
 * every total.
 */
export const auditColumnMap: ColumnMap = {
  at: auditLog.timestamp,
  outcome: auditLog.outcome,
  action: auditLog.action,
  actorType: auditLog.actorType,
  actor: auditLog.actorEmail,
  actorId: auditLog.actorId,
  targetType: auditLog.targetType,
  targetId: auditLog.targetId,
  reason: auditLog.reason,
};

/** Columns the feed returns but nobody filters or sorts on. */
export const auditExtraSelect = {
  id: auditLog.id,
  actorLabel: auditLog.actorLabel,
  target: auditLog.target,
  changes: auditLog.changes,
  durationMs: auditLog.durationMs,
  ip: auditLog.ip,
  userAgent: auditLog.userAgent,
  correlationId: auditLog.correlationId,
  causationId: auditLog.causationId,
};
