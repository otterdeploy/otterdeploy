import { describe, expect, it } from "vite-plus/test";

import type { Manifest } from "../../../stack/manifest";

import { manifestSchema, resolveEnvironment } from "../../../stack/manifest";
import { withEnvironmentOverlay, withoutEnvironmentOverlay } from "../mirror";

const base = manifestSchema.parse({
  version: 1,
  project: "demo",
  services: { web: { source: "image", image: "nginx:1", replicas: 2 } },
  databases: { pg: { engine: "postgres" } },
});

/**
 * The property under test is that an empty overlay IS the mirror: resolving the
 * manifest for that environment must return something equal to base. If that
 * ever stops holding, "staging mirrors production" quietly becomes "staging was
 * a copy of production once".
 */

describe("withEnvironmentOverlay", () => {
  it("adds an empty block for a new environment", () => {
    const next = withEnvironmentOverlay(base, "staging");
    expect(next.environments?.staging).toEqual({});
  });

  it("an empty overlay resolves to a manifest identical to base", () => {
    // This is the whole design. Inheritance is the ABSENCE of an override, so
    // the mirror needs no copying and cannot drift.
    const next = withEnvironmentOverlay(base, "staging");
    const resolved = resolveEnvironment(next, "staging");
    expect(resolved.services).toEqual(base.services);
    expect(resolved.databases).toEqual(base.databases);
  });

  it("a later change to base reaches the mirrored environment", () => {
    const withEnv = withEnvironmentOverlay(base, "staging");
    // Production changes...
    const changed: Manifest = {
      ...withEnv,
      services: { web: { source: "image", image: "nginx:2", replicas: 5 } },
    };
    // ...and staging sees it, because it overrode nothing.
    const resolved = resolveEnvironment(changed, "staging");
    const web = resolved.services.web;
    if (web?.source !== "image") throw new Error("expected the image-sourced web service");
    expect(web.image).toBe("nginx:2");
    expect(web.replicas).toBe(5);
  });

  it("returns the SAME object when the overlay already exists", () => {
    // Identity is the caller's signal that no manifest write is needed.
    // Re-creating an environment must not bump the version and light up a
    // pending change on every other client.
    const once = withEnvironmentOverlay(base, "staging");
    const twice = withEnvironmentOverlay(once, "staging");
    expect(twice).toBe(once);
  });

  it("preserves overlays for other environments", () => {
    const withStaging = withEnvironmentOverlay(base, "staging");
    const withBoth = withEnvironmentOverlay(withStaging, "qa");
    expect(Object.keys(withBoth.environments ?? {}).sort()).toEqual(["qa", "staging"]);
  });

  it("does not disturb an overlay that already carries overrides", () => {
    const customised: Manifest = {
      ...base,
      environments: { staging: { services: { web: { replicas: 1 } } } },
    };
    expect(withEnvironmentOverlay(customised, "staging")).toBe(customised);
  });
});

describe("withoutEnvironmentOverlay", () => {
  it("removes the block so a re-created environment is a clean mirror", () => {
    // A leftover block is inert but a trap: re-creating the slug would silently
    // inherit the deleted environment's overrides.
    const customised: Manifest = {
      ...base,
      environments: { staging: { services: { web: { replicas: 1 } } } },
    };
    const next = withoutEnvironmentOverlay(customised, "staging");
    expect(next.environments).toBeUndefined();
  });

  it("keeps sibling environments", () => {
    const two = withEnvironmentOverlay(withEnvironmentOverlay(base, "staging"), "qa");
    const next = withoutEnvironmentOverlay(two, "staging");
    expect(Object.keys(next.environments ?? {})).toEqual(["qa"]);
  });

  it("returns the SAME object when there is nothing to remove", () => {
    expect(withoutEnvironmentOverlay(base, "staging")).toBe(base);
  });
});
