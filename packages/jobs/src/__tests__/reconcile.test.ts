/**
 * Unit tests for boot-time deploy reconciliation. Everything is injected —
 * no Postgres, no Redis — so these run in plain `bun test`.
 *
 * The db mock is a tiny in-memory store of deployment rows plus a join table
 * for org/resource/project name resolution. It implements only the drizzle
 * chain shapes reconcile.ts actually calls:
 *   - select().from().where()                       → orphan candidates
 *   - select().from().where().orderBy()             → running rows
 *   - select().from().innerJoin().innerJoin().where() → notify join
 *   - update().set().where().returning()            → status flips
 *   - insert().values()                             → deployment_log line
 */
import type { UnknownRecord } from "@otterdeploy/shared/json";

import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

// Resolved in beforeAll AFTER the mock.module() calls below register, so the
// real triggers/db/env modules never load (static imports would hoist above
// the mocks and pull in @otterdeploy/env, which validates env at load time).
let reconcileInterruptedDeployments: typeof import("../reconcile").reconcileInterruptedDeployments;

type Status = "pending" | "building" | "running" | "failed" | "superseded";

interface Row {
  id: string;
  resourceId: string;
  status: Status;
  createdAt: number;
  errorMessage?: string | null;
  completedAt?: Date | null;
}

interface JoinInfo {
  organizationId: string;
  resourceName: string;
  projectName: string;
}

// Index into the in-memory rows with a hard guard, so a missing row fails the
// test loudly instead of leaning on a non-null assertion (which the linter
// forbids and which would mask a genuine reconcile regression).
function firstRow(rows: Row[]): Row {
  const [row] = rows;
  if (!row) throw new Error("expected at least one deployment row");
  return row;
}

function rowById(rows: Row[], id: string): Row {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`expected a deployment row with id ${id}`);
  return row;
}

// ─── db mock ─────────────────────────────────────────────────────────────

function makeDb(rows: Row[], joins: Record<string, JoinInfo> = {}) {
  const logLines: Array<{ deploymentId: string; line: string }> = [];

  // running rows pre-sorted (resourceId asc, createdAt desc) — the order
  // reconcile relies on to keep the newest per resource.
  const runningSorted = () =>
    rows
      .filter((r) => r.status === "running")
      .slice()
      .sort((a, b) =>
        a.resourceId !== b.resourceId
          ? a.resourceId < b.resourceId
            ? -1
            : 1
          : b.createdAt - a.createdAt,
      )
      .map((r) => ({ id: r.id, resourceId: r.resourceId }));

  // A value that is both awaitable (thenable) and exposes .orderBy(), so the
  // same where() works for the orphan/join selects (awaited directly) and the
  // running select (chains .orderBy()).
  const chain = (value: unknown[]) => ({
    then: (resolve: (v: unknown[]) => unknown) => resolve(value),
    orderBy: () => Promise.resolve(value),
  });

  // We infer query intent from the predicate shape produced by the stubbed
  // drizzle-orm: { __allowed } = inArray (orphans), { __eq } = eq status
  // (running), { __id } = eq id (join).
  // UnknownRecord: the projection's values are drizzle column objects and the
  // builder is a heterogeneous bag of chainable methods — runtime values, not
  // JSON.
  const select = (projection: UnknownRecord) => {
    const isJoinSelect = "organizationId" in projection;
    let joined = false;
    const builder: UnknownRecord = {
      from: () => builder,
      innerJoin: () => {
        joined = true;
        return builder;
      },
      where: (pred: { __id?: string; __allowed?: Status[] } | undefined) => {
        if (isJoinSelect && joined) {
          const info = pred?.__id ? joins[pred.__id] : undefined;
          return chain(info ? [info] : []);
        }
        if (pred?.__allowed) {
          // orphan candidates: pending|building
          const allowed = pred.__allowed;
          return chain(
            rows
              .filter((r) => allowed.includes(r.status))
              .map((r) => ({ id: r.id, resourceId: r.resourceId })),
          );
        }
        // running select (eq status running)
        return chain(runningSorted());
      },
    };
    return builder;
  };

  const update = () => {
    let nextStatus: Status = "failed";
    let setFields: Partial<Row> = {};
    const builder: UnknownRecord = {
      set: (fields: Partial<Row>) => {
        setFields = fields;
        nextStatus = fields.status ?? "failed";
        return builder;
      },
      where: (pred: { __id?: string; __allowed?: Status[] }) => {
        const target = rows.find((r) => r.id === pred.__id);
        const allowed = pred.__allowed;
        const ok = target && (!allowed || allowed.includes(target.status));
        return {
          returning: () => {
            if (!ok || !target) return Promise.resolve([]);
            target.status = nextStatus;
            if (setFields.errorMessage !== undefined) target.errorMessage = setFields.errorMessage;
            if (setFields.completedAt !== undefined) target.completedAt = setFields.completedAt;
            return Promise.resolve([{ id: target.id }]);
          },
        };
      },
    };
    return builder;
  };

  const insert = () => ({
    values: (v: { deploymentId: string; line: string }) => {
      logLines.push({ deploymentId: v.deploymentId, line: v.line });
      return Promise.resolve(undefined);
    },
  });

  return { db: { select, update, insert } as never, rows, logLines };
}

// ─── drizzle helper stubs ────────────────────────────────────────────────
//
// reconcile.ts builds predicates with eq()/and()/inArray() from drizzle-orm.
// Those produce opaque SQL objects our mock can't read, so we stub the module
// to emit predicates the mock understands: { __id, __allowed }.

const realDrizzle = await import("drizzle-orm");
void mock.module("drizzle-orm", () => ({
  ...realDrizzle,
  eq: (col: { __col?: string }, val: unknown) =>
    col?.__col === "id" ? { __id: val } : { __eq: val },
  inArray: (_col: unknown, vals: Status[]) => ({ __allowed: vals }),
  // UnknownRecord: predicate marker objects carry arbitrary stubbed values.
  and: (...parts: UnknownRecord[]): UnknownRecord => {
    const merged: UnknownRecord = {};
    for (const part of parts) Object.assign(merged, part);
    return merged;
  },
  desc: (col: unknown) => col,
}));

// Real schema (pure table defs — no env) spread through, but override
// `deployment` so its `id` column carries a marker the stubbed eq() recognises.
const realSchema = await import("@otterdeploy/db/schema");
void mock.module("@otterdeploy/db/schema", () => ({
  ...realSchema,
  deployment: {
    ...realSchema.deployment,
    id: { __col: "id" },
    resourceId: { __col: "resourceId" },
    status: { __col: "status" },
    createdAt: { __col: "createdAt" },
  },
}));

// ─── queue mock ──────────────────────────────────────────────────────────

function makeGetQueue(ownedDeploymentIds: string[][]) {
  const getJobs = mock(async () =>
    ownedDeploymentIds.map((deploymentIds) => ({ data: { deploymentIds } })),
  );
  // Structurally satisfies reconcile's DeployQueueLike — no assertion needed.
  const getQueue = mock(() => ({ getJobs }));
  return { getQueue, getJobs };
}

// ─── notification spy ────────────────────────────────────────────────────
// emitEvent is injected per call rather than module-mocked, so reconcile's
// import graph never pulls in the notification/email delivery stack.

const triggerSpy = mock(async (_event: unknown): Promise<unknown> => undefined);

// always-acquire lock for the happy paths
const acquire = () => Promise.resolve(async () => undefined);

// Deterministic lane discovery — the default listDeployLanes reads a Redis
// set, and these tests must run without Redis (or env) present.
const lanes = () => Promise.resolve(["default"]);

beforeAll(async () => {
  ({ reconcileInterruptedDeployments } = await import("../reconcile"));
});

beforeEach(() => {
  triggerSpy.mockClear();
});

// ─── cases ───────────────────────────────────────────────────────────────

describe("reconcileInterruptedDeployments", () => {
  test("(a) orphaned building with no job → failed + deploy.failed emitted", async () => {
    const { db, rows } = makeDb(
      [{ id: "d1", resourceId: "r1", status: "building", createdAt: 1 }],
      { d1: { organizationId: "o1", resourceName: "api", projectName: "proj" } },
    );
    const { getQueue } = makeGetQueue([]); // no in-flight jobs

    const summary = await reconcileInterruptedDeployments({
      db,
      getQueue,
      listLanes: lanes,
      acquireLock: acquire,
      emitEvent: triggerSpy,
    });

    expect(summary).toEqual({ acquired: true, failed: 1, superseded: 0 });
    expect(firstRow(rows).status).toBe("failed");
    expect(firstRow(rows).errorMessage).toContain("Interrupted by restart");
    expect(triggerSpy).toHaveBeenCalledTimes(1);
    const [firstCall] = triggerSpy.mock.calls;
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]).toMatchObject({
      eventId: "deploy.failed",
      severity: "err",
      organizationId: "o1",
    });
  });

  test("(b) building WITH active job referencing its id → untouched, no notification", async () => {
    const { db, rows } = makeDb([{ id: "d1", resourceId: "r1", status: "building", createdAt: 1 }]);
    const { getQueue } = makeGetQueue([["d1"]]); // a live job owns d1

    const summary = await reconcileInterruptedDeployments({
      db,
      getQueue,
      listLanes: lanes,
      acquireLock: acquire,
      emitEvent: triggerSpy,
    });

    expect(summary).toEqual({ acquired: true, failed: 0, superseded: 0 });
    expect(firstRow(rows).status).toBe("building");
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  test("(c) pending with no job → failed", async () => {
    const { db, rows } = makeDb([{ id: "d1", resourceId: "r1", status: "pending", createdAt: 1 }]);
    const { getQueue } = makeGetQueue([]);

    const summary = await reconcileInterruptedDeployments({
      db,
      getQueue,
      listLanes: lanes,
      acquireLock: acquire,
      emit: false,
    });

    expect(summary.failed).toBe(1);
    expect(firstRow(rows).status).toBe("failed");
  });

  test("(d) mixed batch — only unreferenced rows reset", async () => {
    const { db, rows } = makeDb([
      { id: "d1", resourceId: "r1", status: "building", createdAt: 1 },
      { id: "d2", resourceId: "r2", status: "pending", createdAt: 1 },
      { id: "d3", resourceId: "r3", status: "building", createdAt: 1 },
    ]);
    const { getQueue } = makeGetQueue([["d2"]]); // only d2 owned by a job

    const summary = await reconcileInterruptedDeployments({
      db,
      getQueue,
      listLanes: lanes,
      acquireLock: acquire,
      emit: false,
    });

    expect(summary.failed).toBe(2);
    expect(rowById(rows, "d1").status).toBe("failed");
    expect(rowById(rows, "d2").status).toBe("pending");
    expect(rowById(rows, "d3").status).toBe("failed");
  });

  test("(e) duplicate running same resourceId → older superseded, newest kept; different resource untouched", async () => {
    const { db, rows } = makeDb([
      { id: "new", resourceId: "r1", status: "running", createdAt: 200 },
      { id: "old", resourceId: "r1", status: "running", createdAt: 100 },
      { id: "solo", resourceId: "r2", status: "running", createdAt: 50 },
    ]);
    const { getQueue } = makeGetQueue([]);

    const summary = await reconcileInterruptedDeployments({
      db,
      getQueue,
      listLanes: lanes,
      acquireLock: acquire,
      emit: false,
    });

    expect(summary.superseded).toBe(1);
    expect(rowById(rows, "new").status).toBe("running");
    expect(rowById(rows, "old").status).toBe("superseded");
    expect(rowById(rows, "solo").status).toBe("running");
  });

  test("(f) idempotency — second run does nothing", async () => {
    const { db, rows } = makeDb([{ id: "d1", resourceId: "r1", status: "building", createdAt: 1 }]);
    const { getQueue } = makeGetQueue([]);

    const first = await reconcileInterruptedDeployments({
      db,
      getQueue,
      listLanes: lanes,
      acquireLock: acquire,
      emit: false,
    });
    expect(first.failed).toBe(1);

    const second = await reconcileInterruptedDeployments({
      db,
      getQueue,
      listLanes: lanes,
      acquireLock: acquire,
      emit: false,
    });
    expect(second).toEqual({ acquired: true, failed: 0, superseded: 0 });
    expect(firstRow(rows).status).toBe("failed");
  });

  test("(g) lock not acquired → no-op", async () => {
    const { db, rows } = makeDb([{ id: "d1", resourceId: "r1", status: "building", createdAt: 1 }]);
    const { getQueue, getJobs } = makeGetQueue([]);

    const summary = await reconcileInterruptedDeployments({
      db,
      getQueue,
      listLanes: lanes,
      acquireLock: () => Promise.resolve(null), // lock held elsewhere
      emitEvent: triggerSpy,
    });

    expect(summary).toEqual({ acquired: false, failed: 0, superseded: 0 });
    expect(firstRow(rows).status).toBe("building");
    expect(getJobs).not.toHaveBeenCalled();
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  test("(h) notification rejection is swallowed; status update still happens", async () => {
    triggerSpy.mockImplementationOnce(async () => {
      throw new Error("channel down");
    });
    const { db, rows } = makeDb(
      [{ id: "d1", resourceId: "r1", status: "building", createdAt: 1 }],
      { d1: { organizationId: "o1", resourceName: "api", projectName: "proj" } },
    );
    const { getQueue } = makeGetQueue([]);

    const summary = await reconcileInterruptedDeployments({
      db,
      getQueue,
      listLanes: lanes,
      acquireLock: acquire,
      emitEvent: triggerSpy,
    });

    expect(summary.failed).toBe(1);
    expect(firstRow(rows).status).toBe("failed");
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });

  test("(i) a job on a NAMED lane's queue still protects its row from the orphan scan", async () => {
    const { db, rows } = makeDb([
      { id: "d1", resourceId: "r1", status: "building", createdAt: 1 },
      { id: "d2", resourceId: "r2", status: "pending", createdAt: 1 },
    ]);
    // Per-queue ownership: the default queue is empty, the fast lane owns d1.
    const jobsByQueue: Record<string, string[][]> = {
      "deploy.triggered": [],
      "deploy.triggered.fast": [["d1"]],
    };
    const getQueue = mock((name: string) => ({
      getJobs: async () =>
        (jobsByQueue[name] ?? []).map((deploymentIds) => ({ data: { deploymentIds } })),
    }));

    const summary = await reconcileInterruptedDeployments({
      db,
      getQueue,
      listLanes: () => Promise.resolve(["default", "fast"]),
      acquireLock: acquire,
      emit: false,
    });

    // d1 is owned by the fast lane → untouched; d2 is owned by nothing → reset.
    expect(summary.failed).toBe(1);
    expect(rowById(rows, "d1").status).toBe("building");
    expect(rowById(rows, "d2").status).toBe("failed");
  });
});
