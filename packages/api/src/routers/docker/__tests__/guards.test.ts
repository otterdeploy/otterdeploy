import { describe, expect, test } from "vite-plus/test";

import { guardImageRemoval, guardNetworkRemoval, guardVolumeRemoval } from "../guards";

describe("guardImageRemoval", () => {
  test("unused image ⇒ ok", () => {
    expect(guardImageRemoval({ inUseBy: 0, force: false })).toEqual({ ok: true });
  });

  test("in-use image without force ⇒ refused with count", () => {
    const r = guardImageRemoval({ inUseBy: 3, force: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/3 containers/);
  });

  test("singular phrasing for one container", () => {
    const r = guardImageRemoval({ inUseBy: 1, force: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/1 container\b/);
  });

  test("force bypasses the in-use refusal (daemon still rejects running refs)", () => {
    expect(guardImageRemoval({ inUseBy: 2, force: true })).toEqual({ ok: true });
  });
});

describe("guardVolumeRemoval", () => {
  test("unattached volume ⇒ ok", () => {
    expect(guardVolumeRemoval({ attachedTo: [] })).toEqual({ ok: true });
  });

  test("attached volume ⇒ refused, names the containers", () => {
    const r = guardVolumeRemoval({ attachedTo: ["helio_postgres.1"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("helio_postgres.1");
  });

  test("long attachment lists are truncated with a +N marker", () => {
    const r = guardVolumeRemoval({ attachedTo: ["c1", "c2", "c3", "c4", "c5"] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("c1, c2, c3");
      expect(r.reason).toContain("+2 more");
      expect(r.reason).not.toContain("c4");
    }
  });
});

describe("guardNetworkRemoval", () => {
  test.each(["bridge", "host", "none", "ingress", "docker_gwbridge"])(
    "builtin %s ⇒ refused even when unattached",
    (name) => {
      const r = guardNetworkRemoval({ name, ingress: false, attached: 0 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/builtin/i);
    },
  );

  test("Ingress-flagged network ⇒ refused regardless of name", () => {
    const r = guardNetworkRemoval({ name: "my-mesh", ingress: true, attached: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/builtin/i);
  });

  test("attached user network ⇒ refused with count", () => {
    const r = guardNetworkRemoval({ name: "helio-mesh", ingress: false, attached: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/5 containers/);
  });

  test("unattached user network ⇒ ok", () => {
    expect(guardNetworkRemoval({ name: "helio-mesh", ingress: false, attached: 0 })).toEqual({
      ok: true,
    });
  });
});
