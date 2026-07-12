import { oc } from "@orpc/contract";
import { zId } from "@otterdeploy/shared/id";
import * as z from "zod";

const tag = "audit";
const basePath = "/audit";

const auditActorTypeSchema = z.enum(["user", "system", "api", "agent"]);
const auditOutcomeSchema = z.enum(["success", "failure", "denied"]);

const auditEventSchema = z.object({
  id: z.string(),
  /** ISO-8601 event timestamp (full date+time, e.g. 2026-06-11T22:23:00.051Z).
   *  The handler emits `Date.toISOString()`, so this must be `datetime()` — not
   *  `time()`, which only accepts a time-of-day string and rejects every row. */
  timestamp: z.iso.datetime(),
  action: z.string(),
  actorType: auditActorTypeSchema,
  actorId: z.string(),
  actorEmail: z.string().nullable(),
  actorLabel: z.string().nullable(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  target: z.record(z.string(), z.unknown()).nullable(),
  outcome: auditOutcomeSchema,
  reason: z.string().nullable(),
  durationMs: z.number().nullable(),
  changes: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  correlationId: z.string().nullable(),
  causationId: z.string().nullable(),
});

const listAuditInput = z.object({
  action: z.string().optional(),
  actorId: z.string().optional(),
  outcome: auditOutcomeSchema.optional(),
  targetType: z.string().optional(),
  /** Free-text across action / actor email / actor id / target id. */
  q: z.string().optional(),
  /** ISO timestamps bounding the window. */
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

const listAuditOutput = z.object({
  items: z.array(auditEventSchema),
  /** Total matching the filters (for the stat header + pagination). */
  total: z.number(),
  /** Counts over the *filtered* set, for the summary tiles. */
  counts: z.object({
    total: z.number(),
    failed: z.number(),
    denied: z.number(),
  }),
});

/** Distinct filter values over a time window — feeds the actor / action /
 *  target-kind dropdowns without shipping the whole event set. */
const distinctAuditInput = z.object({
  /** ISO timestamps bounding the window (same semantics as `list`). */
  from: z.string().optional(),
  to: z.string().optional(),
});

const distinctAuditOutput = z.object({
  actors: z.array(
    z.object({
      id: z.string(),
      type: auditActorTypeSchema,
      email: z.string().nullable(),
      label: z.string().nullable(),
    }),
  ),
  actions: z.array(z.string()),
  targetTypes: z.array(z.string()),
});

/** Project-scoped feed for the graph workspace's Activity tab. Matches events
 *  whose target IS the project or whose target carries the project id (the
 *  `{ type: "resource", id, projectId }` shape most resource mutations set). */
const listForProjectInput = z.object({
  projectId: zId("project"),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

const listForProjectOutput = z.object({
  items: z.array(auditEventSchema),
  /** Total matching the project scope, for "load more" honesty. */
  total: z.number(),
});

/** Sibling lookup for the drawer's "Correlated events" section: every event
 *  sharing a correlationId, plus the causing event (causationId is an event
 *  id). Both optional so callers pass whichever the open event carries. */
const byCorrelationInput = z.object({
  correlationId: z.string().optional(),
  causationId: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

const byCorrelationOutput = z.object({
  items: z.array(auditEventSchema),
});

export const auditContract = {
  list: oc
    .meta({ path: basePath, tag, method: "GET" })
    .input(listAuditInput)
    .output(listAuditOutput),
  listForProject: oc
    .meta({ path: `${basePath}/project/{projectId}`, tag, method: "GET" })
    .input(listForProjectInput)
    .output(listForProjectOutput),
  distinct: oc
    .meta({ path: `${basePath}/distinct`, tag, method: "GET" })
    .input(distinctAuditInput)
    .output(distinctAuditOutput),
  byCorrelation: oc
    .meta({ path: `${basePath}/by-correlation`, tag, method: "GET" })
    .input(byCorrelationInput)
    .output(byCorrelationOutput),
};
