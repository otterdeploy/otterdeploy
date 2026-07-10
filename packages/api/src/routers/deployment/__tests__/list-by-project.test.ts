import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

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
  where: vi.fn(),
  orderBy: vi.fn(),
};
selectChain.from.mockReturnValue(selectChain);
selectChain.innerJoin.mockReturnValue(selectChain);
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

const projectId = "project_test" as ProjectId;
const organizationId = "org_test" as OrganizationId;

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
    resourceName: over.resourceId.replace("resource_", ""),
    resourceKind: "service",
    image: over.image ?? "registry.local/app:abc",
    reason: over.reason ?? "git-push",
    status: over.status,
    errorMessage: null,
    gitSha: null,
    gitRef: null,
    gitCommitMessage: null,
    gitCommitAuthor: null,
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

function givenProjectExists() {
  vi.mocked(queries.getProjectInOrg).mockResolvedValue({ id: projectId } as never);
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
  });

  test("latest rows always keep their stored status", () => {
    for (const s of [
      "pending",
      "building",
      "running",
      "failed",
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
    const a = "resource_a" as ResourceId;
    const b = "resource_b" as ResourceId;
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
      ["resource_a", "running", true],
      ["resource_b", "building", true],
      ["resource_a", "superseded", false], // older stored-running → replaced
      ["resource_a", "failed", false], // terminal history stays failed
    ]);
  });

  test("status filter applies to effective status; total counts the filtered set", async () => {
    givenProjectExists();
    const a = "resource_a" as ResourceId;
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
    const a = "resource_a" as ResourceId;
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
    // Newest first.
    expect(new Date(items[0]!.createdAt).getTime()).toBeGreaterThan(
      new Date(items[1]!.createdAt).getTime(),
    );
  });

  test("refines the latest in-flight row via live derivation and reconciles success", async () => {
    givenProjectExists();
    const a = "resource_a" as ResourceId;
    givenRows([
      row({ resourceId: a, status: "building", createdAt: new Date("2026-07-09T10:00:00Z") }),
    ]);
    vi.mocked(resourceQueries.getResourceById).mockResolvedValue({
      kind: "service",
      record: {},
    } as never);
    vi.mocked(derivation.resolveDeploymentServiceName).mockResolvedValue("svc");
    vi.mocked(derivation.loadTaskStatesByDeployment).mockResolvedValue(new Map());
    vi.mocked(derivation.isBuildStillLogging).mockResolvedValue(false);
    vi.mocked(derivation.deriveDeploymentStatus).mockReturnValue("running");
    vi.mocked(derivation.reconcileDeploySuccess).mockResolvedValue(undefined);

    const result = await listProjectDeployments({ projectId, organizationId, limit: 50 });
    const { items } = result.unwrap();
    expect(items[0]?.status).toBe("running");
    expect(derivation.reconcileDeploySuccess).toHaveBeenCalledWith([items[0]!.id], a);
  });
});
