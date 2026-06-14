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
  const select = (projection: Record<string, unknown>) => {
    const isJoinSelect = "organizationId" in projection;
    let joined = false;
    const builder: Record<string, unknown> = {
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
          return chain(
            rows
              .filter((r) => pred.__allowed!.includes(r.status))
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
    const builder: Record<string, unknown> = {
      set: (fields: Partial<Row>) => {
        setFields = fields;
        nextStatus = (fields.status as Status) ?? "failed";
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
            if (setFields.errorMessage !== undefined)
              target.errorMessage = setFields.errorMessage;
            if (setFields.completedAt !== undefined)
              target.completedAt = setFields.completedAt;
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
mock.module("drizzle-orm", () => ({
  ...realDrizzle,
  eq: (col: { __col?: string }, val: unknown) =>
    col?.__col === "id" ? { __id: val } : { __eq: val },
  inArray: (_col: unknown, vals: Status[]) => ({ __allowed: vals }),
  and: (...parts: Array<Record<string, unknown>>) =>
    Object.assign({}, ...parts),
  desc: (col: unknown) => col,
}));

// Real schema (pure table defs — no env) spread through, but override
// `deployment` so its `id` column carries a marker the stubbed eq() recognises.
const realSchema = await import("@otterdeploy/db/schema");
mock.module("@otterdeploy/db/schema", () => ({
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
  const getQueue = mock(() => ({ getJobs })) as never;
  return { getQueue, getJobs };
}

// ─── notification spy ────────────────────────────────────────────────────
// emitEvent is injected per call rather than module-mocked, so reconcile's
// import graph never pulls in the notification/email delivery stack.

const triggerSpy = mock(async () => undefined as unknown);

// always-acquire lock for the happy paths
const acquire = () => Promise.resolve(async () => undefined);

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
      acquireLock: acquire,
      emitEvent: triggerSpy,
    });

    expect(summary).toEqual({ acquired: true, failed: 1, superseded: 0 });
    expect(rows[0].status).toBe("failed");
    expect(rows[0].errorMessage).toContain("Interrupted by restart");
    expect(triggerSpy).toHaveBeenCalledTimes(1);
    expect(triggerSpy.mock.calls[0][0]).toMatchObject({
      eventId: "deploy.failed",
      severity: "err",
      organizationId: "o1",
    });
  });

  test("(b) building WITH active job referencing its id → untouched, no notification", async () => {
    const { db, rows } = makeDb([
      { id: "d1", resourceId: "r1", status: "building", createdAt: 1 },
    ]);
    const { getQueue } = makeGetQueue([["d1"]]); // a live job owns d1

    const summary = await reconcileInterruptedDeployments({
      db,
      getQueue,
      acquireLock: acquire,
      emitEvent: triggerSpy,
    });

    expect(summary).toEqual({ acquired: true, failed: 0, superseded: 0 });
    expect(rows[0].status).toBe("building");
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  test("(c) pending with no job → failed", async () => {
    const { db, rows } = makeDb([
      { id: "d1", resourceId: "r1", status: "pending", createdAt: 1 },
    ]);
    const { getQueue } = makeGetQueue([]);

    const summary = await reconcileInterruptedDeployments({
      db,
      getQueue,
      acquireLock: acquire,
      emit: false,
    });

    expect(summary.failed).toBe(1);
    expect(rows[0].status).toBe("failed");
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
      acquireLock: acquire,
      emit: false,
    });

    expect(summary.failed).toBe(2);
    expect(rows.find((r) => r.id === "d1")!.status).toBe("failed");
    expect(rows.find((r) => r.id === "d2")!.status).toBe("pending");
    expect(rows.find((r) => r.id === "d3")!.status).toBe("failed");
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
      acquireLock: acquire,
      emit: false,
    });

    expect(summary.superseded).toBe(1);
    expect(rows.find((r) => r.id === "new")!.status).toBe("running");
    expect(rows.find((r) => r.id === "old")!.status).toBe("superseded");
    expect(rows.find((r) => r.id === "solo")!.status).toBe("running");
  });

  test("(f) idempotency — second run does nothing", async () => {
    const { db, rows } = makeDb([
      { id: "d1", resourceId: "r1", status: "building", createdAt: 1 },
    ]);
    const { getQueue } = makeGetQueue([]);

    const first = await reconcileInterruptedDeployments({
      db,
      getQueue,
      acquireLock: acquire,
      emit: false,
    });
    expect(first.failed).toBe(1);

    const second = await reconcileInterruptedDeployments({
      db,
      getQueue,
      acquireLock: acquire,
      emit: false,
    });
    expect(second).toEqual({ acquired: true, failed: 0, superseded: 0 });
    expect(rows[0].status).toBe("failed");
  });

  test("(g) lock not acquired → no-op", async () => {
    const { db, rows } = makeDb([
      { id: "d1", resourceId: "r1", status: "building", createdAt: 1 },
    ]);
    const { getQueue, getJobs } = makeGetQueue([]);

    const summary = await reconcileInterruptedDeployments({
      db,
      getQueue,
      acquireLock: () => Promise.resolve(null), // lock held elsewhere
      emitEvent: triggerSpy,
    });

    expect(summary).toEqual({ acquired: false, failed: 0, superseded: 0 });
    expect(rows[0].status).toBe("building");
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
      acquireLock: acquire,
      emitEvent: triggerSpy,
    });

    expect(summary.failed).toBe(1);
    expect(rows[0].status).toBe("failed");
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });
});
