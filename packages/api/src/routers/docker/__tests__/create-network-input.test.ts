import { describe, expect, test } from "vite-plus/test";

import { createNetworkInput } from "../contract-networks";

const base = { name: "shared-mesh", driver: "bridge" };

describe("createNetworkInput", () => {
  test("minimal input parses; attachable defaults on", () => {
    const parsed = createNetworkInput.parse(base);
    expect(parsed.attachable).toBe(true);
    expect(parsed.internal).toBeUndefined();
  });

  test.each([
    ["uppercase", "SharedMesh"],
    ["leading dash", "-mesh"],
    ["leading underscore", "_mesh"],
    ["dot (not allowed, unlike volumes)", "a.b"],
    ["64 chars (over the 63 cap)", "a".repeat(64)],
    ["empty", ""],
  ])("name rejected: %s", (_label, name) => {
    expect(createNetworkInput.safeParse({ ...base, name }).success).toBe(false);
  });

  test("63-char name is the accepted maximum", () => {
    expect(createNetworkInput.safeParse({ ...base, name: "a".repeat(63) }).success).toBe(true);
  });

  test("driver restricted to bridge/overlay", () => {
    expect(createNetworkInput.safeParse({ ...base, driver: "macvlan" }).success).toBe(false);
    expect(createNetworkInput.safeParse({ ...base, driver: "overlay" }).success).toBe(true);
  });

  test.each([
    [67, false], // below the IPv4 minimum
    [68, true],
    [1500, true],
    [65535, true],
    [65536, false],
    [1500.5, false], // must be an integer
  ])("mtu %d ⇒ valid=%s", (mtu, valid) => {
    expect(createNetworkInput.safeParse({ ...base, mtu }).success).toBe(valid);
  });

  test("ipam gateway without subnet ⇒ rejected (superRefine)", () => {
    const r = createNetworkInput.safeParse({ ...base, ipam: [{ gateway: "10.10.0.1" }] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /subnet/.test(i.message))).toBe(true);
    }
  });

  test("ipam ipRange without subnet ⇒ rejected (superRefine)", () => {
    expect(
      createNetworkInput.safeParse({ ...base, ipam: [{ ipRange: "10.10.1.0/24" }] }).success,
    ).toBe(false);
  });

  test("ipam full pool with subnet ⇒ accepted", () => {
    expect(
      createNetworkInput.safeParse({
        ...base,
        ipam: [{ subnet: "10.10.0.0/16", gateway: "10.10.0.1", ipRange: "10.10.1.0/24" }],
      }).success,
    ).toBe(true);
  });

  test("empty ipam pool entry is tolerated (dropped later by the service layer)", () => {
    expect(createNetworkInput.safeParse({ ...base, ipam: [{}] }).success).toBe(true);
  });
});
