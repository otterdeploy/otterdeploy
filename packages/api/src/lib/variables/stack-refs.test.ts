import { describe, expect, it } from "vite-plus/test";

import { extractRefs } from "./parser";
import { buildRefIndex, resolveRefTargetId } from "./stack-refs";

/** One `${{…}}` value → its single parsed ref token. */
const refOf = (value: string) => {
  const [token] = extractRefs(value);
  if (!token) throw new Error(`no ref parsed from ${value}`);
  return token;
};

/**
 * A project holding the `autumn` stack (children `db` + `server`) alongside a
 * STANDALONE resource that also happens to be named `db`. The collision is the
 * point: compose keys and resource names share a namespace only by accident.
 */
const index = buildRefIndex({
  resources: [
    { id: "r_stack", name: "autumn" },
    { id: "r_child_db", name: "autumn-db" },
    { id: "r_child_server", name: "autumn-server" },
    { id: "r_standalone_db", name: "db" },
  ],
  members: [
    { resourceId: "r_child_db", stackId: "r_stack", composeService: "db" },
    { resourceId: "r_child_server", stackId: "r_stack", composeService: "server" },
    { resourceId: "r_standalone_db", stackId: null, composeService: null },
  ],
});

describe("resolveRefTargetId", () => {
  it("resolves a flat ref by resource name", () => {
    expect(resolveRefTargetId(refOf("${{db.HOST}}"), "r_child_server", index)).toBe(
      "r_standalone_db",
    );
  });

  it("resolves the self scope to the caller's own sibling, not the namesake resource", () => {
    // The bug this pins: `db` as a compose key and `db` as a resource name are
    // different things, and the standalone one must never win.
    expect(resolveRefTargetId(refOf("${{stack.db.HOST}}"), "r_child_server", index)).toBe(
      "r_child_db",
    );
  });

  it("resolves an absolute stack ref through the stack's resource name", () => {
    expect(resolveRefTargetId(refOf("${{autumn.db.HOST}}"), "r_standalone_db", index)).toBe(
      "r_child_db",
    );
  });

  it("resolves nothing for a self-scoped ref written outside any stack", () => {
    expect(
      resolveRefTargetId(refOf("${{stack.db.HOST}}"), "r_standalone_db", index),
    ).toBeUndefined();
  });

  it("resolves nothing for a compose key with no child in that stack", () => {
    expect(resolveRefTargetId(refOf("${{autumn.ghost.HOST}}"), "r_child_server", index)).toBe(
      undefined,
    );
  });

  it("resolves nothing when the named stack does not exist", () => {
    expect(resolveRefTargetId(refOf("${{winter.db.HOST}}"), "r_child_server", index)).toBe(
      undefined,
    );
  });

  it("leaves a child without a compose key addressable by name only", () => {
    // Pre-column children (backfill missed them) until their stack reconciles.
    const stale = buildRefIndex({
      resources: [
        { id: "r_stack", name: "autumn" },
        { id: "r_child_db", name: "autumn-db" },
      ],
      members: [{ resourceId: "r_child_db", stackId: "r_stack", composeService: null }],
    });
    expect(resolveRefTargetId(refOf("${{autumn.db.HOST}}"), "r_child_db", stale)).toBeUndefined();
    expect(resolveRefTargetId(refOf("${{autumn-db.HOST}}"), "r_child_db", stale)).toBe(
      "r_child_db",
    );
  });
});
