import { describe, expect, test } from "bun:test";

import { builderFlags, cacheFlags, cachePathFor } from "../buildx";

describe("builderFlags", () => {
  test("emits --builder when a name is set", () => {
    expect(builderFlags("otterdeploy-cache")).toEqual([
      "--builder",
      "otterdeploy-cache",
    ]);
  });

  test("emits nothing for null/undefined", () => {
    expect(builderFlags(null)).toEqual([]);
    expect(builderFlags(undefined)).toEqual([]);
  });
});

describe("cacheFlags", () => {
  test("emits local cache import + export when builder AND path are set", () => {
    expect(cacheFlags("otterdeploy-cache", "/cache/repo")).toEqual([
      "--cache-from",
      "type=local,src=/cache/repo",
      "--cache-to",
      "type=local,dest=/cache/repo,mode=max",
    ]);
  });

  test("emits nothing unless BOTH are set (default driver rejects cache export)", () => {
    expect(cacheFlags(null, "/cache/repo")).toEqual([]);
    expect(cacheFlags("otterdeploy-cache", null)).toEqual([]);
    expect(cacheFlags(null, null)).toEqual([]);
    expect(cacheFlags("otterdeploy-cache", undefined)).toEqual([]);
  });
});

describe("cachePathFor", () => {
  test("maps an image repo to one path-safe dir under buildx-cache", () => {
    const path = cachePathFor("ghcr.io/acme/web");
    expect(path.endsWith("/buildx-cache/ghcr.io_acme_web")).toBe(true);
  });

  test("collapses registry host + slashes so distinct repos don't collide dirs", () => {
    expect(cachePathFor("otterdeploy-local/web")).not.toEqual(
      cachePathFor("otterdeploy-local/api"),
    );
    // same repo → same dir (stable cache key)
    expect(cachePathFor("repo/x")).toEqual(cachePathFor("repo/x"));
  });
});
