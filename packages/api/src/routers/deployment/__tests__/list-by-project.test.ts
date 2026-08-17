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
}));

vi.mock("../../project/deployments-list", () => ({
  deriveDeploymentStatus: vi.fn(),
  isBuildStillLogging: vi.fn(),
  loadTaskStatesByDeployment: vi.fn(),
  reconcileDeploySuccess: vi.fn(),
  resolveDeploymentServiceName: vi.fn(),
}));

const selectChain = {
  from: vi.fn(),
  innerJoin: vi.fn(),
  leftJoin: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
};
selectChain.from.mockReturnValue(selectChain);
selectChain.innerJoin.mockReturnValue(selectChain);
selectChain.leftJoin.mockReturnValue(selectChain);
selectChain.where.mockReturnValue(selectChain);

vi.mock("@otterdeploy/db", () => ({
  db: { select: vi.fn(() => selectChain) },
}));

import * as derivation from "../../project/deployments-list";
import * as queries from "../../project/queries";
import * as resourceQueries from "../../project/queries/resource";
import {
  effectiveListedStatus,
  listProjectDeployments,
  matchesStatusFilter,
} from "../list-by-project";

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
    gitCommitAuthor: null,
    sourceSha: null,
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
        image: "registry.local/app:abc",
        imageDigest: null,
        command: null,
        entrypoint: null,
        source: "image",
        sourceSubdir: null,
        framework: null,
        replicas: 1,
        pausedReplicas: null,
        restartCondition: "on-failure",
        restartMaxAttempts: null,
        restartDelayMs: 5000,
        restartWindowMs: null,
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

describe("effectiveListedStatus", () => {
  test("non-latest unsettled rows read as superseded", () => {
    expect(effectiveListedStatus("running", false)).toBe("superseded");
    expect(effectiveListedStatus("building", false)).toBe("superseded");
    expect(effectiveListedStatus("pending", false)).toBe("superseded");
  });

  test("non-latest terminal rows keep their stored status", () => {
    expect(effectiveListedStatus("failed", false)).toBe("failed");
    expect(effectiveListedStatus("removed", false)).toBe("removed");
    expect(effectiveListedStatus("superseded", false)).toBe("superseded");
    // A cancel is an outcome, not an in-flight row a newer deploy replaced.
    // It must not be rewritten to `superseded` once something newer lands.
    expect(effectiveListedStatus("cancelled", false)).toBe("cancelled");
  });

  test("latest rows always keep their stored status", () => {
    for (const s of [
      "pending",
      "building",
      "running",
      "failed",
      "cancelled",
      "superseded",
      "removed",
    ] as const) {
      expect(effectiveListedStatus(s, true)).toBe(s);
    }
  });
});

describe("matchesStatusFilter", () => {
  test("building covers stored pending on the latest row", () => {
    expect(matchesStatusFilter("building", "pending", true)).toBe(true);
    expect(matchesStatusFilter("building", "building", true)).toBe(true);
    // …but a non-latest building row is superseded, not building.
    expect(matchesStatusFilter("building", "building", false)).toBe(false);
  });

  test("running only matches the latest live row", () => {
    expect(matchesStatusFilter("running", "running", true)).toBe(true);
    expect(matchesStatusFilter("running", "running", false)).toBe(false);
  });

  test("superseded matches stored superseded and replaced unsettled rows", () => {
    expect(matchesStatusFilter("superseded", "superseded", false)).toBe(true);
    expect(matchesStatusFilter("superseded", "running", false)).toBe(true);
    expect(matchesStatusFilter("superseded", "running", true)).toBe(false);
    expect(matchesStatusFilter("superseded", "failed", false)).toBe(false);
  });

  test("failed matches regardless of latest position", () => {
    expect(matchesStatusFilter("failed", "failed", true)).toBe(true);
    expect(matchesStatusFilter("failed", "failed", false)).toBe(true);
  });
});

// ── List assembly ────────────────────────────────────────────────────────

describe("listProjectDeployments", () => {
  test("returns ProjectNotFoundError when the project isn't in the org", async () => {
    vi.mocked(queries.getProjectInOrg).mockResolvedValue(undefined);
    const result = await listProjectDeployments({ projectId, organizationId, limit: 50 });
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

    const result = await listProjectDeployments({ projectId, organizationId, limit: 50 });
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

    const result = await listProjectDeployments({ projectId, organizationId, limit: 2 });
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
    vi.mocked(derivation.deriveDeploymentStatus).mockReturnValue("running");
    vi.mocked(derivation.reconcileDeploySuccess).mockResolvedValue(undefined);

    const result = await listProjectDeployments({ projectId, organizationId, limit: 50 });
    const { items } = result.unwrap();
    const [first] = items;
    if (!first) throw new Error("expected a deployment item");
    expect(first.status).toBe("running");
    expect(derivation.reconcileDeploySuccess).toHaveBeenCalledWith([first.id], a);
  });
});

describe("matchesStatusFilter, cancelled", () => {
  test("is filterable on its own so stopped builds are findable in history", () => {
    expect(matchesStatusFilter("cancelled", "cancelled", true)).toBe(true);
    expect(matchesStatusFilter("cancelled", "cancelled", false)).toBe(true);
  });

  test("the building filter does not sweep up cancelled rows", () => {
    // `building` covers stored `pending` because both render as in-flight; a
    // cancelled row is settled and must not appear under it.
    expect(matchesStatusFilter("building", "cancelled", true)).toBe(false);
  });

  test("cancelled is not confused with failed in either direction", () => {
    expect(matchesStatusFilter("failed", "cancelled", true)).toBe(false);
    expect(matchesStatusFilter("cancelled", "failed", true)).toBe(false);
  });
});
