import { idSchema } from "@otterdeploy/shared/id";
import { describe, expect, test, vi } from "vite-plus/test";

// ── Mocks ────────────────────────────────────────────────────────────────
// The subject reads the project guard from ../project/queries, the docker
// refinement helpers from ../project/deployments-list, and rows from the db.

vi.mock("../../project/queries", () => ({
  getProjectInOrg: vi.fn(),
}));

vi.mock("../../project/queries/resource", () => ({
  getResourceById: vi.fn(),
  // Env scoping composes into the SQL where(); its own semantics are covered
  // by the resource-queries tests. Returning undefined = "no extra condition".
  inEnvironmentScope: vi.fn(() => undefined),
}));

vi.mock("../../project/deployments-list", () => ({
  deriveDeploymentStatus: vi.fn(),
  isBuildStillLogging: vi.fn(),
  loadTaskStatesByDeployment: vi.fn(),
  resolveDeploymentServiceName: vi.fn(),
}));

// The read-side success detector (it skips rows a deploy job still owns,
// which needs the queue): its own behaviour is pinned in
// project/__tests__/deployments-reconcile.test.ts.
vi.mock("../../project/deployments-reconcile", () => ({
  isOwnedInFlight: vi.fn(),
  reconcileObservedSuccess: vi.fn(),
}));

const selectChain = {
  from: vi.fn(),
  innerJoin: vi.fn(),
  leftJoin: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  // mainEnvironmentName's lookup ends in .limit(); resolving [] makes every
  // NULL-stamped row read as the "main" fallback in these tests.
  limit: vi.fn().mockResolvedValue([]),
};
selectChain.from.mockReturnValue(selectChain);
selectChain.innerJoin.mockReturnValue(selectChain);
selectChain.leftJoin.mockReturnValue(selectChain);
selectChain.where.mockReturnValue(selectChain);

vi.mock("@otterdeploy/db", () => ({
  db: { select: vi.fn(() => selectChain) },
}));

import * as derivation from "../../project/deployments-list";
import * as reconcile from "../../project/deployments-reconcile";
import * as queries from "../../project/queries";
import * as resourceQueries from "../../project/queries/resource";
import { listProjectDeployments } from "../list-by-project";
import {
  computeStats,
  listedStatus,
  matchesPeople,
  matchesQuery,
  matchesStatusFilter,
  medianDurationMs,
  peopleFacets,
  resolveServing,
} from "../list-filters";

// Branded at the boundary the same way production code does: through the id
// schema, using the canonical short prefixes so no legacy rewrite kicks in.
const projectId = idSchema.project.parse("prj_test");
const organizationId = idSchema.organization.parse("org_test");

let seq = 0;
function row(over: {
  resourceId: string;
  status: string;
  createdAt: Date;
  image?: string;
  reason?: string;
  gitCommitAuthor?: string;
}) {
  seq += 1;
  return {
    id: `deployment_${seq}`,
    resourceId: over.resourceId,
    resourceName: over.resourceId.replace("res_", ""),
    resourceKind: "service",
    image: over.image ?? "registry.local/app:abc",
    reason: over.reason ?? "git-push",
    status: over.status,
    errorMessage: null,
    gitSha: null,
    gitRef: null,
    gitCommitMessage: null,
    gitCommitAuthor: over.gitCommitAuthor ?? null,
    gitCommitAuthorAvatar: null,
    sourceSha: null,
    previewId: null,
    environmentName: null,
    actorName: null,
    actorImage: null,
    completedAt: null,
    createdAt: over.createdAt,
    updatedAt: over.createdAt,
  };
}

function givenRows(rows: ReturnType<typeof row>[]) {
  // The subject sorts in SQL; the mock must return rows already desc-ordered.
  const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  selectChain.orderBy.mockResolvedValue(sorted);
}

// Complete rows, typed straight off the queries' own return types, so the
// mocks feed the subject exactly what the real queries would.
type ProjectRow = NonNullable<Awaited<ReturnType<typeof queries.getProjectInOrg>>>;
type ResourceLookup = NonNullable<Awaited<ReturnType<typeof resourceQueries.getResourceById>>>;

const projectRow: ProjectRow = {
  id: projectId,
  organizationId,
  name: "test",
  slug: "test",
  importedFrom: null,
  buildServerId: null,
  environmentId: null,
  stackFile: null,
  stackFileVersion: 0,
  lastAppliedFile: null,
  lastAppliedAt: null,
  manifest: null,
  manifestVersion: 0,
  lastAppliedManifest: null,
  lastManifestAppliedAt: null,
  customDomain: null,
  customDomainVerifiedAt: null,
  customDomainVerifyToken: null,
  nixpacksConfig: null,
  graphLayout: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

/** A full service-resource join for one resource id; only `kind` and
 *  `pausedReplicas` steer the subject, everything else is honest filler. */
function serviceLookup(resourceId: ReturnType<typeof idSchema.resource.parse>): ResourceLookup {
  return {
    kind: "service",
    record: {
      resource: {
        id: resourceId,
        projectId,
        name: resourceId.replace("res_", ""),
        type: "service",
        status: "valid",
        environmentId: null,
        previewId: null,
        branchedFromResourceId: null,
        placementServerId: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
      service: {
        resourceId,
        buildServerId: null,
        image: "registry.local/app:abc",
        imageDigest: null,
        command: null,
        entrypoint: null,
        extraNetworks: [],
        composeService: null,
        source: "image",
        sourceSubdir: null,
        framework: null,
        imageBuilder: null,
        replicas: 1,
        pausedReplicas: null,
        restartCondition: "on-failure",
        restartMaxAttempts: null,
        restartDelayMs: 5000,
        restartWindowMs: null,
        stopGracePeriodMs: null,
        stopSignal: null,
        healthcheckCmd: null,
        healthcheckIntervalMs: null,
        healthcheckTimeoutMs: null,
        healthcheckRetries: null,
        healthcheckStartMs: null,
        cpuLimit: null,
        memoryLimitMb: null,
        cpuReservation: null,
        memoryReservationMb: null,
        diskLimitMb: null,
        swapLimitMb: null,
        pidsLimit: null,
        preDeploy: null,
        postDeploy: null,
        buildConfig: null,
        gitRepoId: null,
        branch: null,
        imageRepository: null,
        previewsEnabled: false,
        internalHostname: "app.internal",
        serviceName: "svc",
        networkName: "net",
        publicEnabled: false,
        publicDomain: null,
        envChangedAt: null,
        envAppliedAt: null,
        stackId: null,
        forceUpdateCounter: 0,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    },
  };
}

function givenProjectExists() {
  vi.mocked(queries.getProjectInOrg).mockResolvedValue(projectRow);
  // Refinement candidates resolve no resource → statuses stay stored.
  vi.mocked(resourceQueries.getResourceById).mockResolvedValue(null);
}

// ── Pure status semantics ────────────────────────────────────────────────

describe("listedStatus", () => {
  const listed = (
    status: Parameters<typeof listedStatus>[0]["status"],
    isLatest: boolean,
    isServing = false,
  ) => listedStatus({ status, isLatest, isServing });

  test("older rows that never settled were replaced", () => {
    expect(listed("running", false)).toBe("superseded");
    expect(listed("building", false)).toBe("superseded");
    expect(listed("pending", false)).toBe("superseded");
  });

  test("older terminal rows keep their stored outcome", () => {
    expect(listed("failed", false)).toBe("failed");
    expect(listed("removed", false)).toBe("removed");
    expect(listed("superseded", false)).toBe("superseded");
    // A cancel is an outcome, not an in-flight row a newer deploy replaced.
    expect(listed("cancelled", false)).toBe("cancelled");
  });

  test("an older row a resource is still serving stays running", () => {
    expect(listed("running", false, true)).toBe("running");
  });

  test("the newest row shows its live-derived status when one was read", () => {
    expect(listedStatus({ status: "building", isLatest: true, isServing: false }, "starting")).toBe(
      "starting",
    );
    expect(listedStatus({ status: "running", isLatest: true, isServing: true }, "crashed")).toBe(
      "crashed",
    );
    expect(listed("building", true)).toBe("building");
  });
});

describe("resolveServing", () => {
  const a = idSchema.resource.parse("res_a");
  const newRow = idSchema.deployment.parse("dep_new");
  const oldRow = idSchema.deployment.parse("dep_old");
  const running = new Map([[a, oldRow]]);

  test("the previous deploy keeps serving while the newest is still coming up", () => {
    for (const derived of ["starting", undefined] as const) {
      const serving = resolveServing(
        [{ id: newRow, resourceId: a, stored: "building", derived }],
        running,
      );
      expect(serving.get(a)).toBe(oldRow);
    }
  });

  test("the newest deploy serves once its containers are up", () => {
    const serving = resolveServing(
      [{ id: newRow, resourceId: a, stored: "building", derived: "running" }],
      running,
    );
    expect(serving.get(a)).toBe(newRow);
  });

  test("a crash-looping or paused newest deploy is still the one in place", () => {
    for (const derived of ["crashed", "paused"] as const) {
      const serving = resolveServing(
        [{ id: newRow, resourceId: a, stored: "running", derived }],
        running,
      );
      expect(serving.get(a)).toBe(newRow);
    }
  });

  test("a failed or cancelled newest deploy never displaces the one serving", () => {
    for (const stored of ["failed", "cancelled"] as const) {
      const serving = resolveServing(
        [{ id: newRow, resourceId: a, stored, derived: "crashed" }],
        running,
      );
      expect(serving.get(a)).toBe(oldRow);
    }
  });

  test("a resource that never came up is serving nothing", () => {
    const serving = resolveServing(
      [{ id: newRow, resourceId: a, stored: "failed", derived: undefined }],
      new Map(),
    );
    expect(serving.has(a)).toBe(false);
  });
});

describe("matchesStatusFilter", () => {
  const row = (status: Parameters<typeof matchesStatusFilter>[1]["status"], isServing = false) => ({
    status,
    isServing,
  });

  test("building is everything still in progress", () => {
    expect(matchesStatusFilter("building", row("pending"))).toBe(true);
    expect(matchesStatusFilter("building", row("building"))).toBe(true);
    expect(matchesStatusFilter("building", row("starting"))).toBe(true);
    expect(matchesStatusFilter("building", row("superseded"))).toBe(false);
    expect(matchesStatusFilter("building", row("cancelled"))).toBe(false);
  });

  test("failed is everything that broke, crash loops included", () => {
    expect(matchesStatusFilter("failed", row("failed"))).toBe(true);
    expect(matchesStatusFilter("failed", row("crashed", true))).toBe(true);
    expect(matchesStatusFilter("failed", row("cancelled"))).toBe(false);
    expect(matchesStatusFilter("cancelled", row("failed"))).toBe(false);
  });

  test("serving matches the serving row whatever its status", () => {
    expect(matchesStatusFilter("serving", row("running", true))).toBe(true);
    expect(matchesStatusFilter("serving", row("crashed", true))).toBe(true);
    expect(matchesStatusFilter("serving", row("running", false))).toBe(false);
  });

  test("the rest match the listed status exactly", () => {
    expect(matchesStatusFilter("superseded", row("superseded"))).toBe(true);
    expect(matchesStatusFilter("running", row("running", true))).toBe(true);
    expect(matchesStatusFilter("cancelled", row("cancelled"))).toBe(true);
  });
});

// ── List assembly ────────────────────────────────────────────────────────

describe("listProjectDeployments", () => {
  test("returns ProjectNotFoundError when the project isn't in the org", async () => {
    vi.mocked(queries.getProjectInOrg).mockResolvedValue(undefined);
    const result = await listProjectDeployments({
      projectId,
      organizationId,
      limit: 50,
      offset: 0,
    });
    expect(result.isErr()).toBe(true);
  });

  test("marks each resource's newest row as latest and supersedes older live rows", async () => {
    givenProjectExists();
    const a = idSchema.resource.parse("res_a");
    const b = idSchema.resource.parse("res_b");
    givenRows([
      row({ resourceId: a, status: "running", createdAt: new Date("2026-07-09T10:00:00Z") }),
      row({ resourceId: a, status: "running", createdAt: new Date("2026-07-08T10:00:00Z") }),
      row({ resourceId: a, status: "failed", createdAt: new Date("2026-07-07T10:00:00Z") }),
      row({ resourceId: b, status: "building", createdAt: new Date("2026-07-09T09:00:00Z") }),
    ]);

    const result = await listProjectDeployments({
      projectId,
      organizationId,
      limit: 50,
      offset: 0,
    });
    expect(result.isOk()).toBe(true);
    const { items, total } = result.unwrap();
    expect(total).toBe(4);
    expect(items.map((i) => [i.resourceId, i.status, i.isLatest])).toEqual([
      ["res_a", "running", true],
      ["res_b", "building", true],
      ["res_a", "superseded", false], // older stored-running → replaced
      ["res_a", "failed", false], // terminal history stays failed
    ]);
  });

  test("status filter applies to effective status; total counts the filtered set", async () => {
    givenProjectExists();
    const a = idSchema.resource.parse("res_a");
    givenRows([
      row({ resourceId: a, status: "running", createdAt: new Date("2026-07-09T10:00:00Z") }),
      row({ resourceId: a, status: "running", createdAt: new Date("2026-07-08T10:00:00Z") }),
      row({ resourceId: a, status: "failed", createdAt: new Date("2026-07-07T10:00:00Z") }),
    ]);

    const result = await listProjectDeployments({
      projectId,
      organizationId,
      status: "superseded",
      limit: 50,
      offset: 0,
    });
    const { items, total } = result.unwrap();
    expect(total).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe("superseded");
    expect(items[0]?.isLatest).toBe(false);
  });

  test("limit slices the page but total reports the full match count", async () => {
    givenProjectExists();
    const a = idSchema.resource.parse("res_a");
    givenRows(
      Array.from({ length: 5 }, (_, i) =>
        row({
          resourceId: a,
          status: "superseded",
          createdAt: new Date(Date.UTC(2026, 6, 1 + i)),
        }),
      ),
    );

    const result = await listProjectDeployments({ projectId, organizationId, limit: 2, offset: 0 });
    const { items, total } = result.unwrap();
    expect(total).toBe(5);
    expect(items).toHaveLength(2);
    const [first, second] = items;
    if (!first || !second) throw new Error("expected two deployment items");
    // Newest first.
    expect(new Date(first.createdAt).getTime()).toBeGreaterThan(
      new Date(second.createdAt).getTime(),
    );
  });

  test("refines the latest in-flight row via live derivation and reconciles success", async () => {
    givenProjectExists();
    const a = idSchema.resource.parse("res_a");
    givenRows([
      row({ resourceId: a, status: "building", createdAt: new Date("2026-07-09T10:00:00Z") }),
    ]);
    vi.mocked(resourceQueries.getResourceById).mockResolvedValue(serviceLookup(a));
    vi.mocked(derivation.resolveDeploymentServiceName).mockResolvedValue("svc");
    vi.mocked(derivation.loadTaskStatesByDeployment).mockResolvedValue(new Map());
    vi.mocked(derivation.isBuildStillLogging).mockResolvedValue(false);
    vi.mocked(reconcile.isOwnedInFlight).mockResolvedValue(false);
    vi.mocked(derivation.deriveDeploymentStatus).mockReturnValue("running");
    vi.mocked(reconcile.reconcileObservedSuccess).mockResolvedValue(undefined);

    const result = await listProjectDeployments({
      projectId,
      organizationId,
      limit: 50,
      offset: 0,
    });
    const { items } = result.unwrap();
    const [first] = items;
    if (!first) throw new Error("expected a deployment item");
    expect(first.status).toBe("running");
    expect(reconcile.reconcileObservedSuccess).toHaveBeenCalledWith([first.id], a);
  });
});

// ── Search, stats, and pagination semantics ──────────────────────────────

describe("matchesQuery", () => {
  const base = {
    resourceName: "web",
    gitSha: "e59629f7abc",
    gitCommitMessage: "feat(web): template search",
    gitCommitAuthor: "Jace",
    image: "registry.local/web:e59629f",
    sourceSha: null,
  };

  test("matches case-insensitively across provenance fields", () => {
    expect(matchesQuery(base, "E59629")).toBe(true);
    expect(matchesQuery(base, "template SEARCH")).toBe(true);
    expect(matchesQuery(base, "jace")).toBe(true);
    expect(matchesQuery(base, "registry.local")).toBe(true);
  });

  test("blank or whitespace query matches everything", () => {
    expect(matchesQuery(base, "")).toBe(true);
    expect(matchesQuery(base, "   ")).toBe(true);
  });

  test("misses honestly and ignores null fields", () => {
    expect(matchesQuery(base, "postgres")).toBe(false);
    expect(matchesQuery({ ...base, gitSha: null, gitCommitMessage: null }, "e59629")).toBe(true);
  });
});

describe("medianDurationMs", () => {
  const timed = (createdAt: string, completedAt: string | null) => ({
    createdAt: new Date(createdAt),
    completedAt: completedAt ? new Date(completedAt) : null,
  });

  test("odd and even counts, incomplete rows excluded", () => {
    expect(
      medianDurationMs([
        timed("2026-08-20T10:00:00Z", "2026-08-20T10:01:00Z"), // 60s
        timed("2026-08-20T10:00:00Z", "2026-08-20T10:03:00Z"), // 180s
        timed("2026-08-20T10:00:00Z", null), // in flight, excluded
      ]),
    ).toBe(120_000);
    expect(
      medianDurationMs([
        timed("2026-08-20T10:00:00Z", "2026-08-20T10:01:00Z"), // 60s
        timed("2026-08-20T10:00:00Z", "2026-08-20T10:02:00Z"), // 120s
        timed("2026-08-20T10:00:00Z", "2026-08-20T10:04:00Z"), // 240s
      ]),
    ).toBe(120_000);
  });

  test("null when nothing completed", () => {
    expect(medianDurationMs([])).toBeNull();
    expect(medianDurationMs([timed("2026-08-20T10:00:00Z", null)])).toBeNull();
  });
});

describe("computeStats", () => {
  test("counts the listed status, through the same groups the filter uses", () => {
    const at = new Date("2026-08-20T10:00:00Z");
    const stats = computeStats([
      { status: "running", isServing: true, createdAt: at, completedAt: null },
      { status: "starting", isServing: false, createdAt: at, completedAt: null },
      { status: "building", isServing: false, createdAt: at, completedAt: null },
      { status: "failed", isServing: false, createdAt: at, completedAt: null },
      { status: "crashed", isServing: true, createdAt: at, completedAt: null },
      { status: "superseded", isServing: false, createdAt: at, completedAt: null },
    ]);
    expect(stats).toEqual({
      windowTotal: 6,
      failed: 2,
      inFlight: 2,
      serving: 2,
      medianDurationMs: null,
    });
  });
});

describe("people", () => {
  const push = (author: string) => ({
    reason: "git-push",
    triggeredBy: null,
    gitCommitAuthor: author,
    gitCommitAuthorAvatar: null,
  });
  const clicked = (name: string, reason = "redeploy") => ({
    reason,
    triggeredBy: { name, image: null },
    gitCommitAuthor: "Marcus",
    gitCommitAuthorAvatar: null,
  });
  const keyed = {
    reason: "redeploy",
    triggeredBy: null,
    gitCommitAuthor: null,
    gitCommitAuthorAvatar: null,
  };

  test("a deploy is credited to who asked for it, not the commit's author", () => {
    expect(matchesPeople(clicked("Ada", "rollback"), { names: ["Ada"], automatic: false })).toBe(
      true,
    );
    expect(matchesPeople(clicked("Ada", "rollback"), { names: ["Marcus"], automatic: false })).toBe(
      false,
    );
  });

  test("a push is credited to the commit's author; nobody at all is automatic", () => {
    expect(matchesPeople(push("Marcus"), { names: ["Marcus"], automatic: false })).toBe(true);
    expect(matchesPeople(keyed, { names: ["Marcus"], automatic: false })).toBe(false);
    expect(matchesPeople(keyed, { names: [], automatic: true })).toBe(true);
    expect(matchesPeople(push("Marcus"), { names: [], automatic: true })).toBe(false);
  });

  test("an empty filter matches everything", () => {
    expect(matchesPeople(keyed, { names: [], automatic: false })).toBe(true);
  });

  test("facets list people most active first, and count the automatic ones", () => {
    expect(peopleFacets([push("Marcus"), clicked("Ada"), push("Marcus"), keyed])).toEqual({
      people: [
        { name: "Marcus", image: null, count: 2 },
        { name: "Ada", image: null, count: 1 },
      ],
      automatic: 1,
    });
  });
});

describe("listProjectDeployments, search + offset + stats", () => {
  test("q narrows items, total, and stats together", async () => {
    givenProjectExists();
    const a = idSchema.resource.parse("res_web");
    const b = idSchema.resource.parse("res_postgres");
    givenRows([
      row({ resourceId: a, status: "running", createdAt: new Date("2026-07-09T10:00:00Z") }),
      row({ resourceId: b, status: "running", createdAt: new Date("2026-07-09T09:00:00Z") }),
    ]);

    const result = await listProjectDeployments({
      projectId,
      organizationId,
      q: "postgres",
      limit: 50,
      offset: 0,
    });
    const { items, total, stats } = result.unwrap();
    expect(total).toBe(1);
    expect(items.map((i) => i.resourceName)).toEqual(["postgres"]);
    expect(stats.windowTotal).toBe(1);
  });

  test("offset pages past earlier rows while total spans the full match set", async () => {
    givenProjectExists();
    const a = idSchema.resource.parse("res_a");
    givenRows(
      Array.from({ length: 5 }, (_, i) =>
        row({
          resourceId: a,
          status: "superseded",
          createdAt: new Date(Date.UTC(2026, 6, 1 + i)),
        }),
      ),
    );

    const page2 = await listProjectDeployments({ projectId, organizationId, limit: 2, offset: 2 });
    const { items, total } = page2.unwrap();
    expect(total).toBe(5);
    expect(items).toHaveLength(2);
    // Newest-first ordering: offset 2 lands on the 3rd- and 4th-newest rows.
    expect(items.map((i) => new Date(i.createdAt).getUTCDate())).toEqual([3, 2]);
  });

  test("stats ignore the status filter while items respect it", async () => {
    givenProjectExists();
    const a = idSchema.resource.parse("res_a");
    givenRows([
      row({ resourceId: a, status: "running", createdAt: new Date("2026-07-09T10:00:00Z") }),
      row({ resourceId: a, status: "failed", createdAt: new Date("2026-07-08T10:00:00Z") }),
      row({ resourceId: a, status: "failed", createdAt: new Date("2026-07-07T10:00:00Z") }),
    ]);

    const result = await listProjectDeployments({
      projectId,
      organizationId,
      status: "failed",
      limit: 50,
      offset: 0,
    });
    const { items, total, stats } = result.unwrap();
    expect(total).toBe(2);
    expect(items).toHaveLength(2);
    expect(stats.windowTotal).toBe(3);
    expect(stats.failed).toBe(2);
  });

  test("rows resolve the main-environment name for NULL-stamped resources", async () => {
    givenProjectExists();
    const a = idSchema.resource.parse("res_a");
    givenRows([
      row({ resourceId: a, status: "running", createdAt: new Date("2026-07-09T10:00:00Z") }),
    ]);
    const result = await listProjectDeployments({
      projectId,
      organizationId,
      limit: 50,
      offset: 0,
    });
    const { items } = result.unwrap();
    // The mocked env lookup returns no row, so the honest fallback applies.
    expect(items[0]?.environmentName).toBe("main");
  });
});

describe("listProjectDeployments, one status for rows and counts", () => {
  /** The newest row of `resourceId` derives to `derived` from its live tasks. */
  function givenLiveStatus(
    resourceId: ReturnType<typeof idSchema.resource.parse>,
    derived: Awaited<ReturnType<typeof derivation.deriveDeploymentStatus>>,
  ) {
    vi.mocked(resourceQueries.getResourceById).mockResolvedValue(serviceLookup(resourceId));
    vi.mocked(derivation.resolveDeploymentServiceName).mockResolvedValue("svc");
    vi.mocked(derivation.loadTaskStatesByDeployment).mockResolvedValue(new Map());
    vi.mocked(derivation.isBuildStillLogging).mockResolvedValue(false);
    vi.mocked(reconcile.isOwnedInFlight).mockResolvedValue(false);
    vi.mocked(reconcile.reconcileObservedSuccess).mockResolvedValue(undefined);
    vi.mocked(derivation.deriveDeploymentStatus).mockReturnValue(derived);
  }

  const list = (over: Partial<Parameters<typeof listProjectDeployments>[0]> = {}) =>
    listProjectDeployments({ projectId, organizationId, limit: 50, offset: 0, ...over });

  test("a row shown as failed is counted as failed, not in flight", async () => {
    givenProjectExists();
    const a = idSchema.resource.parse("res_web");
    givenRows([
      // Stored `building`, but nothing has run for longer than any build does:
      // the live derivation calls it failed, and so must the summary.
      row({ resourceId: a, status: "building", createdAt: new Date("2026-07-09T10:00:00Z") }),
    ]);
    givenLiveStatus(a, "failed");

    const { items, stats } = (await list()).unwrap();
    expect(items.map((i) => i.status)).toEqual(["failed"]);
    expect(stats.failed).toBe(1);
    expect(stats.inFlight).toBe(0);
  });

  test("the failed filter finds the row the list shows as failed", async () => {
    givenProjectExists();
    const a = idSchema.resource.parse("res_web");
    givenRows([
      row({ resourceId: a, status: "building", createdAt: new Date("2026-07-09T10:00:00Z") }),
    ]);
    givenLiveStatus(a, "failed");

    const { items, total } = (await list({ status: "failed" })).unwrap();
    expect(total).toBe(1);
    expect(items[0]?.status).toBe("failed");
  });

  test("while a deploy rolls out, the previous one is the one serving", async () => {
    givenProjectExists();
    const a = idSchema.resource.parse("res_web");
    givenRows([
      row({ resourceId: a, status: "building", createdAt: new Date("2026-07-09T10:00:00Z") }),
      row({ resourceId: a, status: "running", createdAt: new Date("2026-07-08T10:00:00Z") }),
    ]);
    givenLiveStatus(a, "starting");

    const { items, stats, serving } = (await list()).unwrap();
    expect(items.map((i) => [i.status, i.isLatest, i.isServing])).toEqual([
      ["starting", true, false],
      ["running", false, true],
    ]);
    expect(stats.serving).toBe(1);
    expect(serving.map((s) => s.deploymentId)).toEqual([items[1]?.id]);
  });

  test("once the new deploy is up it serves, and the old one was replaced", async () => {
    givenProjectExists();
    const a = idSchema.resource.parse("res_web");
    givenRows([
      row({ resourceId: a, status: "building", createdAt: new Date("2026-07-09T10:00:00Z") }),
      row({ resourceId: a, status: "running", createdAt: new Date("2026-07-08T10:00:00Z") }),
    ]);
    givenLiveStatus(a, "running");

    const { items } = (await list()).unwrap();
    expect(items.map((i) => [i.status, i.isServing])).toEqual([
      ["running", true],
      ["superseded", false],
    ]);
  });

  test("a failed build leaves the previous deploy serving", async () => {
    givenProjectExists();
    const a = idSchema.resource.parse("res_web");
    givenRows([
      row({ resourceId: a, status: "failed", createdAt: new Date("2026-07-09T10:00:00Z") }),
      row({ resourceId: a, status: "running", createdAt: new Date("2026-07-08T10:00:00Z") }),
    ]);

    const { items } = (await list()).unwrap();
    expect(items.map((i) => [i.status, i.isServing])).toEqual([
      ["failed", false],
      ["running", true],
    ]);
  });

  test("the serving filter lists one row per resource", async () => {
    givenProjectExists();
    const a = idSchema.resource.parse("res_web");
    const b = idSchema.resource.parse("res_api");
    givenRows([
      row({ resourceId: a, status: "failed", createdAt: new Date("2026-07-09T10:00:00Z") }),
      row({ resourceId: a, status: "running", createdAt: new Date("2026-07-08T10:00:00Z") }),
      row({ resourceId: a, status: "running", createdAt: new Date("2026-07-07T10:00:00Z") }),
      row({ resourceId: b, status: "running", createdAt: new Date("2026-07-06T10:00:00Z") }),
    ]);

    const { items, total } = (await list({ status: "serving" })).unwrap();
    expect(total).toBe(2);
    expect(items.map((i) => i.resourceId)).toEqual(["res_web", "res_api"]);
  });

  test("what a resource serves is reported even when it predates the window", async () => {
    givenProjectExists();
    const a = idSchema.resource.parse("res_web");
    const old = row({
      resourceId: a,
      status: "running",
      createdAt: new Date("2026-06-01T10:00:00Z"),
    });
    const recent = row({
      resourceId: a,
      status: "failed",
      createdAt: new Date("2026-07-09T10:00:00Z"),
    });
    // First read: the window. Second read: every stored-running row.
    selectChain.orderBy.mockResolvedValueOnce([recent]).mockResolvedValueOnce([old]);

    const { items, serving, stats } = (
      await list({ since: new Date("2026-07-01T00:00:00Z") })
    ).unwrap();
    expect(items.map((i) => [i.id, i.isServing])).toEqual([[recent.id, false]]);
    expect(stats.serving).toBe(0);
    expect(serving).toEqual([
      expect.objectContaining({ resourceId: a, deploymentId: old.id, image: old.image }),
    ]);
  });

  test("the person filter narrows the list and the summary, not the options", async () => {
    givenProjectExists();
    const a = idSchema.resource.parse("res_web");
    givenRows([
      row({
        resourceId: a,
        status: "running",
        createdAt: new Date("2026-07-09T10:00:00Z"),
        gitCommitAuthor: "Marcus",
      }),
      row({
        resourceId: a,
        status: "failed",
        createdAt: new Date("2026-07-08T10:00:00Z"),
        gitCommitAuthor: "Priya",
      }),
    ]);

    const { items, stats, facets } = (
      await list({ people: { names: ["Priya"], automatic: false } })
    ).unwrap();
    expect(items.map((i) => i.gitCommitAuthor)).toEqual(["Priya"]);
    expect(stats.windowTotal).toBe(1);
    expect(stats.failed).toBe(1);
    expect(facets.people.map((p) => p.name)).toEqual(["Marcus", "Priya"]);
  });
});
