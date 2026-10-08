import { describe, expect, test } from "bun:test";

import {
  builderFlags,
  buildxCreateArgs,
  cacheFlags,
  cachePathFor,
  parseBuilderEndpoint,
} from "../buildx";

describe("buildxCreateArgs (od-48w isolation invariants)", () => {
  const endpoint = "docker-container://otterdeploy-buildkitd";

  test("always uses the remote driver, never the privileged docker-container one", () => {
    const args = buildxCreateArgs(endpoint);
    expect(args).toEqual([
      "buildx",
      "create",
      "--name",
      "otterdeploy-rootless",
      "--driver",
      "remote",
      "--bootstrap",
      endpoint,
    ]);
    // The dominant od-48w vector was a `--driver docker-container` builder that
    // boots buildkitd `--privileged`. It must never be created again.
    expect(args).not.toContain("docker-container");
    const driverIdx = args.indexOf("--driver");
    expect(args[driverIdx + 1]).toBe("remote");
  });

  test("never bootstraps a rootless IMAGE into a docker-container (the old half-fix)", () => {
    // `--driver-opt image=moby/buildkit:*-rootless` still booted privileged on
    // the buildx version in use; the remote driver is the real fix.
    const args = buildxCreateArgs(endpoint);
    expect(args.join(" ")).not.toMatch(/--driver-opt/);
    expect(args.join(" ")).not.toMatch(/image=/);
  });

  test("never grants the insecure entitlement RUN --security=insecure needs", () => {
    const args = buildxCreateArgs(endpoint);
    expect(args.join(" ")).not.toMatch(/insecure/);
    expect(args.join(" ")).not.toMatch(/allow/);
  });

  test("points only at the given rootless endpoint", () => {
    expect(buildxCreateArgs(endpoint).at(-1)).toBe(endpoint);
  });
});

describe("builderFlags", () => {
  test("emits --builder when a name is set", () => {
    expect(builderFlags("otterdeploy-rootless")).toEqual(["--builder", "otterdeploy-rootless"]);
  });

  test("emits nothing for null/undefined", () => {
    expect(builderFlags(null)).toEqual([]);
    expect(builderFlags(undefined)).toEqual([]);
  });
});

describe("cacheFlags", () => {
  test("emits local cache import + export when builder AND path are set", () => {
    expect(cacheFlags("otterdeploy-rootless", "/cache/repo")).toEqual([
      "--cache-from",
      "type=local,src=/cache/repo",
      "--cache-to",
      "type=local,dest=/cache/repo,mode=max",
    ]);
  });

  test("drops --cache-from under noCache but keeps --cache-to (repopulate)", () => {
    expect(cacheFlags("otterdeploy-rootless", "/cache/repo", true)).toEqual([
      "--cache-to",
      "type=local,dest=/cache/repo,mode=max",
    ]);
  });

  test("emits nothing unless BOTH are set (default driver rejects cache export)", () => {
    expect(cacheFlags(null, "/cache/repo")).toEqual([]);
    expect(cacheFlags("otterdeploy-rootless", null)).toEqual([]);
    expect(cacheFlags(null, null)).toEqual([]);
    expect(cacheFlags("otterdeploy-rootless", undefined)).toEqual([]);
  });
});

describe("cachePathFor (od-48w per-tenant namespacing)", () => {
  const scope = (organizationId: string, projectId: string, imageRepository: string) => ({
    organizationId,
    projectId,
    imageRepository,
  });

  test("maps a build to one path-safe dir under cache/buildx/<org>/<project>/<repo>", () => {
    const path = cachePathFor(scope("org_1", "proj_1", "ghcr.io/acme/web"));
    expect(path.endsWith("/cache/buildx/org_1/proj_1/ghcr.io_acme_web")).toBe(true);
  });

  test("two orgs' registry-less 'otterdeploy-local/web' NEVER collide on one dir", () => {
    // This is the cross-tenant cache-poisoning bug: serviceName is not
    // org-scoped, so both orgs minted the same `otterdeploy-local/web` repo and
    // shared one mutable cache dir. Namespacing by org makes that impossible.
    const a = cachePathFor(scope("org_a", "proj_a", "otterdeploy-local/web"));
    const b = cachePathFor(scope("org_b", "proj_b", "otterdeploy-local/web"));
    expect(a).not.toEqual(b);
  });

  test("same org+project+repo → same dir (stable, warm cache within a tenant)", () => {
    expect(cachePathFor(scope("o", "p", "repo/x"))).toEqual(
      cachePathFor(scope("o", "p", "repo/x")),
    );
  });

  test("a different project in the same org gets its own dir", () => {
    expect(cachePathFor(scope("o", "p1", "repo/x"))).not.toEqual(
      cachePathFor(scope("o", "p2", "repo/x")),
    );
  });

  test("collapses path separators so no segment can escape its namespace", () => {
    // Slashes (the only traversal risk, since each segment is one path
    // component) collapse to `_`; a literal `..` left between underscores is a
    // harmless single component, not a parent-dir hop.
    const path = cachePathFor(scope("org/../x", "p:p", "a/b:c"));
    expect(path.endsWith("/cache/buildx/org_.._x/p_p/a_b_c")).toBe(true);
    expect(path.split("/cache/buildx/")[1]?.split("/")).toEqual(["org_.._x", "p_p", "a_b_c"]);
  });
});

describe("parseBuilderEndpoint", () => {
  test("reads the endpoint of an existing remote builder", () => {
    const inspect = [
      "Name:          otterdeploy-rootless",
      "Driver:        remote",
      "",
      "Nodes:",
      "Name:             otterdeploy-rootless0",
      "Endpoint:         docker-container://otterdeploy-buildkitd",
      "Status:           running",
    ].join("\n");
    expect(parseBuilderEndpoint(inspect)).toBe("docker-container://otterdeploy-buildkitd");
  });

  test("null when there is no endpoint line", () => {
    expect(parseBuilderEndpoint("Name: x\nDriver: remote\n")).toBeNull();
  });
});
