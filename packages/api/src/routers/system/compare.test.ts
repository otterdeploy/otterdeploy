import { describe, expect, it } from "vite-plus/test";

import { compareVersions, isNewer, parseVersion } from "./compare";

describe("parseVersion", () => {
  it("parses v-prefixed and bare semver", () => {
    expect(parseVersion("v0.5.0")).toEqual({ major: 0, minor: 5, patch: 0, prerelease: "" });
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: "" });
  });

  it("captures a prerelease", () => {
    expect(parseVersion("v0.5.0-rc.1")).toEqual({
      major: 0,
      minor: 5,
      patch: 0,
      prerelease: "rc.1",
    });
  });

  it("returns null for non-release sentinels and garbage", () => {
    expect(parseVersion("dev")).toBeNull();
    expect(parseVersion("latest")).toBeNull();
    expect(parseVersion("")).toBeNull();
    expect(parseVersion(null)).toBeNull();
    expect(parseVersion("v1.2")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("orders numerically, not lexically", () => {
    expect(compareVersions("v0.4.0", "v0.10.0")).toBe(-1);
    expect(compareVersions("v0.10.0", "v0.9.9")).toBe(1);
    expect(compareVersions("v1.0.0", "v1.0.0")).toBe(0);
  });

  it("sorts a prerelease before its final release", () => {
    expect(compareVersions("v0.5.0-rc.1", "v0.5.0")).toBe(-1);
    expect(compareVersions("v0.5.0", "v0.5.0-rc.1")).toBe(1);
  });

  it("treats unparseable inputs as older than any real version", () => {
    expect(compareVersions("dev", "v0.1.0")).toBe(-1);
    expect(compareVersions("v0.1.0", "dev")).toBe(1);
    expect(compareVersions("dev", "latest")).toBe(0);
  });
});

describe("nightly-channel ordering (release-channels design)", () => {
  it("orders dated nightlies chronologically (zero-padded dates sort lexically)", () => {
    expect(compareVersions("v0.16.0-nightly.20260820", "v0.16.0-nightly.20260821")).toBe(-1);
    expect(compareVersions("v0.16.0-nightly.20260821", "v0.16.0-nightly.20260820")).toBe(1);
  });

  it("a nightly sorts AFTER the stable it forked from and BEFORE the stable it becomes", () => {
    // Nightlies carry next-minor: users on nightly are ahead of current stable…
    expect(isNewer("v0.15.2", "v0.16.0-nightly.20260820")).toBe(true);
    // …and the eventual stable of the same core outranks every nightly of it
    // (the channel-switch catch-up point).
    expect(isNewer("v0.16.0-nightly.20260820", "v0.16.0")).toBe(true);
    // A nightly of the NEXT core never counts as an update for the current stable
    // running on the stable channel resolver, but the comparator itself must
    // still refuse the reverse direction (downgrade guard).
    expect(isNewer("v0.16.0", "v0.16.0-nightly.20260820")).toBe(false);
  });
});

describe("isNewer (the update-available predicate)", () => {
  it("is true only when latest is a real version strictly newer than current", () => {
    expect(isNewer("v0.5.0", "v0.5.1")).toBe(true);
    expect(isNewer("v0.5.0", "v1.0.0")).toBe(true);
    expect(isNewer("v0.5.0-rc.1", "v0.5.0")).toBe(true);
    // dev checkout: any real release is an update.
    expect(isNewer("dev", "v0.1.0")).toBe(true);
  });

  it("blocks downgrades and no-ops (the safety guard)", () => {
    expect(isNewer("v0.5.1", "v0.5.0")).toBe(false); // downgrade
    expect(isNewer("v0.5.0", "v0.5.0")).toBe(false); // equal
  });

  it("never triggers on a garbage or missing latest", () => {
    expect(isNewer("v0.5.0", "dev")).toBe(false);
    expect(isNewer("v0.5.0", "garbage")).toBe(false);
    expect(isNewer("v0.5.0", null)).toBe(false);
  });
});
