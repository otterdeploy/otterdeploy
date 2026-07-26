import type { OrganizationId } from "@otterdeploy/shared/id";

import { describe, expect, test, vi } from "vite-plus/test";

// ── Mocks ────────────────────────────────────────────────────────────────
// clusterProjectPills only reads project rows — a chainable select mock
// covering select().from().where() is enough.
const selectChain = {
  from: vi.fn(),
  where: vi.fn(),
};
selectChain.from.mockReturnValue(selectChain);

vi.mock("@otterdeploy/db", () => ({
  db: { select: vi.fn(() => selectChain) },
}));

import { clusterProjectPills } from "../stats";

const organizationId = "org_test" as OrganizationId;

describe("clusterProjectPills (od-1kc.4: ghost project chips)", () => {
  test("drops a project slug that no longer exists in the DB instead of falling back to the raw slug", async () => {
    // Docker still has a running container/task labelled
    // otterdeploy.project=store (leftover from a pre-nuke install) alongside
    // a real, current project. The DB query only returns rows for slugs that
    // actually exist — "store" isn't among them.
    selectChain.where.mockResolvedValueOnce([{ slug: "storefront", name: "Storefront" }]);

    const result = await clusterProjectPills(
      organizationId,
      new Map([
        ["storefront", 2],
        ["store", 1],
      ]),
    );

    expect(result).toEqual([{ slug: "storefront", name: "Storefront", tasksRunning: 2 }]);
    expect(result.find((p) => p.slug === "store")).toBeUndefined();
  });

  test("empty task-count map skips the DB round-trip and returns no pills", async () => {
    const result = await clusterProjectPills(organizationId, new Map());
    expect(result).toEqual([]);
  });

  test("sorts by tasksRunning descending", async () => {
    selectChain.where.mockResolvedValueOnce([
      { slug: "a", name: "A" },
      { slug: "b", name: "B" },
    ]);

    const result = await clusterProjectPills(
      organizationId,
      new Map([
        ["a", 1],
        ["b", 5],
      ]),
    );

    expect(result.map((p) => p.slug)).toEqual(["b", "a"]);
  });
});
