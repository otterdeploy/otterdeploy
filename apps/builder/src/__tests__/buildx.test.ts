import { describe, expect, test } from "bun:test";

import { builderFlags, buildxCreateArgs, buildxInspectArgs, readBuildkitAddr } from "../buildx";

describe("builderFlags", () => {
  test("emits --builder when a name is set", () => {
    expect(builderFlags("otterdeploy-remote")).toEqual(["--builder", "otterdeploy-remote"]);
  });

  test("emits nothing for null/undefined", () => {
    expect(builderFlags(null)).toEqual([]);
    expect(builderFlags(undefined)).toEqual([]);
  });
});

describe("buildxCreateArgs", () => {
  test("creates a REMOTE-driver builder pointed at the standalone buildkitd", () => {
    const args = buildxCreateArgs("otterdeploy-remote", "tcp://buildkitd:1234");
    expect(args).toEqual([
      "buildx",
      "create",
      "--name",
      "otterdeploy-remote",
      "--driver",
      "remote",
      "tcp://buildkitd:1234",
    ]);
  });

  // od-48w: the shared privileged docker-container builder is the exact bug
  // this module closes. Assert the generated argv can never regress into
  // that shape — no docker-container driver, no --privileged, no --bootstrap
  // (which only applies to a buildx-managed container, which `remote` never
  // creates).
  test("never falls back to the privileged docker-container driver", () => {
    const args = buildxCreateArgs("otterdeploy-remote", "tcp://buildkitd:1234");
    expect(args).not.toContain("docker-container");
    expect(args).not.toContain("--privileged");
    expect(args).not.toContain("--bootstrap");
    expect(args).toContain("remote");
  });

  test("works for a unix-socket address too", () => {
    const args = buildxCreateArgs("otterdeploy-remote", "unix:///run/buildkit/buildkitd.sock");
    expect(args[args.length - 1]).toBe("unix:///run/buildkit/buildkitd.sock");
    expect(args).toContain("remote");
  });
});

describe("buildxInspectArgs", () => {
  test("inspects the named builder with --bootstrap (connectivity probe)", () => {
    expect(buildxInspectArgs("otterdeploy-remote")).toEqual([
      "buildx",
      "inspect",
      "otterdeploy-remote",
      "--bootstrap",
    ]);
  });
});

describe("readBuildkitAddr", () => {
  test("reads BUILDKIT_ADDR from the given env", () => {
    expect(readBuildkitAddr({ BUILDKIT_ADDR: "tcp://buildkitd:1234" })).toBe(
      "tcp://buildkitd:1234",
    );
  });

  test("returns undefined when unset or empty — no remote builder is attempted", () => {
    expect(readBuildkitAddr({})).toBeUndefined();
    expect(readBuildkitAddr({ BUILDKIT_ADDR: "" })).toBeUndefined();
  });
});
