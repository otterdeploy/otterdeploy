import type { Id, IdPrefix } from "@otterdeploy/shared/id";

import { hasPrefix, ID_PREFIX } from "@otterdeploy/shared/id";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../routers/service/queries", () => ({
  findServiceDependentsByName: vi.fn(async () => []),
  getServiceRecord: vi.fn(),
  getStackRefIdentity: vi.fn(async () => undefined),
}));

import {
  findServiceDependentsByName,
  getServiceRecord,
  getStackRefIdentity,
} from "../../routers/service/queries";
import { findTransitiveDependents } from "./graph";

/** Brand a fixture id after genuinely checking its prefix instead of casting. */
function idOf<P extends IdPrefix>(prefix: P, value: string): Id<P> {
  if (!hasPrefix(value, prefix)) throw new Error(`expected a "${prefix}" id, got "${value}"`);
  return value;
}

const PROJECT_ID = idOf(ID_PREFIX.project, "project_1");
const DB_CHILD = idOf(ID_PREFIX.resource, "resource_dbchild");
const API = idOf(ID_PREFIX.resource, "resource_api");
const WEB = idOf(ID_PREFIX.resource, "resource_web");

function asMock(fn: unknown) {
  if (!vi.isMockFunction(fn)) throw new Error("expected a vi.fn() mock");
  return fn;
}

/** A service record with just the fields the walk reads. */
const record = (id: string, name: string, env: Record<string, string>) => ({
  resource: { id, name, type: "service" as const },
  service: { resourceId: id },
  env: Object.entries(env).map(([key, value], i) => ({ id: `v${i}`, key, value })),
});

describe("findTransitiveDependents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asMock(findServiceDependentsByName).mockResolvedValue([]);
    asMock(getStackRefIdentity).mockResolvedValue(undefined);
  });

  it("carries the target's stack identity into the dependent lookup", async () => {
    // Without this, a sibling referencing `${{stack.db.HOST}}` is invisible to
    // the name-pattern scan and never redeploys when db's exports change.
    asMock(getStackRefIdentity).mockImplementation(async (id: string) =>
      id === DB_CHILD
        ? { stackId: "resource_stack", stackName: "autumn", composeService: "db" }
        : undefined,
    );

    await findTransitiveDependents({
      projectId: PROJECT_ID,
      targetResourceId: DB_CHILD,
      targetResourceName: "autumn-db",
    });

    expect(findServiceDependentsByName).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      targetResourceName: "autumn-db",
      stackRef: { stackId: "resource_stack", stackName: "autumn", composeService: "db" },
    });
  });

  it("returns a sibling that references the target by compose key", async () => {
    asMock(getStackRefIdentity).mockImplementation(async (id: string) =>
      id === DB_CHILD
        ? { stackId: "resource_stack", stackName: "autumn", composeService: "db" }
        : undefined,
    );
    asMock(findServiceDependentsByName).mockImplementation(
      async (input: { targetResourceName: string }) =>
        input.targetResourceName === "autumn-db" ? [API] : [],
    );
    asMock(getServiceRecord).mockResolvedValue(
      record(API, "autumn-server", { DATABASE_URL: "postgres://${{stack.db.HOST}}:5432/x" }),
    );

    const result = await findTransitiveDependents({
      projectId: PROJECT_ID,
      targetResourceId: DB_CHILD,
      targetResourceName: "autumn-db",
    });

    expect(result).toEqual([API]);
  });

  it("does not re-walk from a dependent whose only ref is the node it came from", async () => {
    // The stack ref that got us here must be recognised AS the arrival edge,
    // or every stack child re-queues its own referrer forever.
    asMock(getStackRefIdentity).mockImplementation(async (id: string) =>
      id === DB_CHILD
        ? { stackId: "resource_stack", stackName: "autumn", composeService: "db" }
        : undefined,
    );
    asMock(findServiceDependentsByName).mockImplementation(
      async (input: { targetResourceName: string }) =>
        input.targetResourceName === "autumn-db" ? [API] : [],
    );
    asMock(getServiceRecord).mockResolvedValue(
      record(API, "autumn-server", { URL: "${{stack.db.HOST}}" }),
    );

    await findTransitiveDependents({
      projectId: PROJECT_ID,
      targetResourceId: DB_CHILD,
      targetResourceName: "autumn-db",
    });

    // One lookup for the seed only: the dependent had nothing else to follow.
    expect(asMock(findServiceDependentsByName).mock.calls).toHaveLength(1);
  });

  it("walks transitively through a service that references something else", async () => {
    asMock(findServiceDependentsByName).mockImplementation(
      async (input: { targetResourceName: string }) => {
        if (input.targetResourceName === "db") return [API];
        if (input.targetResourceName === "api") return [WEB];
        return [];
      },
    );
    asMock(getServiceRecord).mockImplementation(async (_pid: string, id: string) =>
      id === API
        ? record(API, "api", { DATABASE_URL: "${{db.URL}}", CACHE: "${{redis.URL}}" })
        : record(WEB, "web", { API_URL: "${{api.URL}}" }),
    );

    const result = await findTransitiveDependents({
      projectId: PROJECT_ID,
      targetResourceId: idOf(ID_PREFIX.resource, "resource_db"),
      targetResourceName: "db",
    });

    expect(result).toEqual([API, WEB]);
  });
});
