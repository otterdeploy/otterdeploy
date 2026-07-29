import type { OrganizationId, ServerId } from "@otterdeploy/shared/id";

import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../../runtime", () => ({ isSwarmRuntime: vi.fn() }));
vi.mock("@otterdeploy/db", () => ({ db: {} }));

import { isSwarmRuntime } from "../../../runtime";
import { branchPlacementConflict } from "../branch-placement";

const organizationId = "org_1" as OrganizationId;
const worker = "srv_worker" as ServerId;

/**
 * Both branch transports reach the database from the control plane's own host —
 * `docker exec` over the local socket, and `runOnHost` nsentering PID 1. On
 * Swarm a database can be scheduled anywhere, so an unpinned or worker-pinned
 * database with branching enabled is a configuration that cannot work.
 *
 * SCOPE: these cover the two short-circuits that decide whether the rule
 * applies at all — they are the branches that run on every apply. Comparing a
 * pin against the control-plane row needs a real `server` table and belongs in
 * the integration suite; asserting it here would mean stubbing the module under
 * test against itself, which proves nothing.
 */

describe("branchPlacementConflict", () => {
  it("never complains about a database that does not branch", async () => {
    vi.mocked(isSwarmRuntime).mockReturnValue(true);
    const conflict = await branchPlacementConflict({
      organizationId,
      placementServerId: worker,
      previewBranching: false,
    });
    expect(conflict).toBeNull();
  });

  it("never complains on the Docker runtime, whatever the pin says", async () => {
    // One host: both transports are local by definition, so placement is moot.
    // This is what keeps the guard invisible to every single-node install.
    vi.mocked(isSwarmRuntime).mockReturnValue(false);
    expect(
      await branchPlacementConflict({
        organizationId,
        placementServerId: null,
        previewBranching: true,
      }),
    ).toBeNull();
    expect(
      await branchPlacementConflict({
        organizationId,
        placementServerId: worker,
        previewBranching: true,
      }),
    ).toBeNull();
  });

  it("checks the runtime before touching the database", async () => {
    // Ordering matters: the guard runs on every manifest apply, so the common
    // path (Docker, or branching off) must not cost a query.
    vi.mocked(isSwarmRuntime).mockReturnValue(false);
    await branchPlacementConflict({
      organizationId,
      placementServerId: worker,
      previewBranching: true,
    });
    expect(vi.mocked(isSwarmRuntime)).toHaveBeenCalled();
  });
});
