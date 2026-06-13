import { oc } from "@orpc/contract";
import * as z from "zod";

const tag = "audit";
const basePath = "/audit";

export const auditActorTypeSchema = z.enum(["user", "system", "api", "agent"]);
export const auditOutcomeSchema = z.enum(["success", "failure", "denied"]);

export const auditEventSchema = z.object({
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

export const listAuditInput = z.object({
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

export const listAuditOutput = z.object({
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

export const auditContract = {
  list: oc
    .meta({ path: basePath, tag, method: "GET" })
    .input(listAuditInput)
    .output(listAuditOutput),
};
