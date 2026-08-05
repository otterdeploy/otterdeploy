/**
 * Compose named volumes are file-local (`data`, `db-data`), so the docker
 * volume behind one has to be scoped to its stack — otherwise two stacks in a
 * project share a volume and each other's data.
 *
 * The mapper used to drop named volumes entirely. Services then fell back to an
 * ANONYMOUS volume from their image's own VOLUME directive — a fresh, empty one
 * on every redeploy — or got no persistence at all. Determinism is the whole
 * point of the name: a redeploy must reattach the same data.
 */

import { describe, expect, it } from "vite-plus/test";

import { composeVolumeName } from "../reconcile-map";

describe("composeVolumeName", () => {
  it("scopes the volume to its stack", () => {
    expect(composeVolumeName("store-vaultwarden", "vaultwarden-data")).toBe(
      "od-store-vaultwarden-vaultwarden-data",
    );
  });

  it("is deterministic — a redeploy reattaches the same volume", () => {
    const a = composeVolumeName("store-rustfs", "rustfs-data");
    const b = composeVolumeName("store-rustfs", "rustfs-data");
    expect(a).toBe(b);
  });

  it("keeps two stacks that both call their volume `data` apart", () => {
    expect(composeVolumeName("store-ghost", "data")).not.toBe(
      composeVolumeName("store-umami", "data"),
    );
  });

  it("produces a name docker accepts", () => {
    // [a-zA-Z0-9][a-zA-Z0-9_.-] and 63 chars is the practical ceiling.
    const name = composeVolumeName("store-My Stack!", "Weird Name/v1");
    expect(name).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
    expect(name.length).toBeLessThanOrEqual(63);
  });
});
