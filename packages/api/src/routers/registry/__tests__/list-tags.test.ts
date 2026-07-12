/**
 * Pure parsing logic for the registry tag browser. Body/header shapes
 * mirror real Docker Registry v2 responses (Docker Hub, GHCR) so the
 * parsers stay pinned to what's in the wild.
 */

import { describe, expect, it } from "vitest";

import {
  TAG_PAGE_LIMIT,
  hasNextPage,
  imageSizeFromManifest,
  parseImageRef,
  parseTagsBody,
  registryApiHost,
} from "../list-tags";

describe("parseImageRef", () => {
  it("maps a bare official image to docker.io/library", () => {
    expect(parseImageRef("nginx")).toEqual({ host: "docker.io", repository: "library/nginx" });
  });

  it("maps an org path to docker.io without the library prefix", () => {
    expect(parseImageRef("acme/api")).toEqual({ host: "docker.io", repository: "acme/api" });
  });

  it("splits fully-qualified refs into host + repository", () => {
    expect(parseImageRef("ghcr.io/acme/api")).toEqual({
      host: "ghcr.io",
      repository: "acme/api",
    });
    expect(parseImageRef("registry.gitlab.com/group/sub/app")).toEqual({
      host: "registry.gitlab.com",
      repository: "group/sub/app",
    });
  });

  it("strips :tag and @digest suffixes", () => {
    expect(parseImageRef("nginx:1.27-alpine")).toEqual({
      host: "docker.io",
      repository: "library/nginx",
    });
    expect(parseImageRef("ghcr.io/acme/api@sha256:abc123")).toEqual({
      host: "ghcr.io",
      repository: "acme/api",
    });
  });

  it("keeps a registry port distinct from a tag colon", () => {
    expect(parseImageRef("registry.local:5000/team/app")).toEqual({
      host: "registry.local:5000",
      repository: "team/app",
    });
    expect(parseImageRef("localhost:5000/app:dev")).toEqual({
      host: "localhost:5000",
      repository: "app",
    });
  });

  it("lowercases the repository (registries are case-sensitive-rejecting)", () => {
    expect(parseImageRef("ghcr.io/Acme/API")).toEqual({ host: "ghcr.io", repository: "acme/api" });
  });

  it("returns null for malformed references", () => {
    expect(parseImageRef("")).toBeNull();
    expect(parseImageRef("   ")).toBeNull();
    expect(parseImageRef(":latest")).toBeNull();
    expect(parseImageRef("ghcr.io/acme//api")).toBeNull();
    expect(parseImageRef("ghcr.io/-bad/api")).toBeNull();
    expect(parseImageRef("has space/app")).toBeNull();
  });
});

describe("registryApiHost", () => {
  it("routes docker.io to its actual v2 API host", () => {
    expect(registryApiHost("docker.io")).toBe("registry-1.docker.io");
  });
  it("leaves every other host alone", () => {
    expect(registryApiHost("ghcr.io")).toBe("ghcr.io");
    expect(registryApiHost("registry.local:5000")).toBe("registry.local:5000");
  });
});

describe("parseTagsBody", () => {
  it("extracts tags from a v2 tags/list body", () => {
    expect(
      parseTagsBody({ name: "library/nginx", tags: ["latest", "1.27", "1.27-alpine"] }),
    ).toEqual(["latest", "1.27", "1.27-alpine"]);
  });

  it("treats a null tags field as an empty repository (GHCR emits this)", () => {
    expect(parseTagsBody({ name: "acme/api", tags: null })).toEqual([]);
  });

  it("drops non-string entries and rejects malformed bodies", () => {
    expect(parseTagsBody({ tags: ["ok", 7, null, "also-ok"] })).toEqual(["ok", "also-ok"]);
    expect(parseTagsBody(null)).toBeNull();
    expect(parseTagsBody("nope")).toBeNull();
    expect(parseTagsBody({ tags: "latest" })).toBeNull();
  });
});

describe("hasNextPage", () => {
  it("detects the RFC-5988 next link Docker Hub sends", () => {
    expect(hasNextPage('</v2/library/nginx/tags/list?last=1.27&n=50>; rel="next"')).toBe(true);
    expect(hasNextPage("</v2/x/tags/list?n=50>; rel=next")).toBe(true);
  });
  it("is false without a header or a next relation", () => {
    expect(hasNextPage(null)).toBe(false);
    expect(hasNextPage('</v2/x>; rel="prev"')).toBe(false);
  });
});

describe("imageSizeFromManifest", () => {
  it("sums config + layer sizes for a single-arch v2 manifest", () => {
    expect(
      imageSizeFromManifest({
        schemaVersion: 2,
        mediaType: "application/vnd.docker.distribution.manifest.v2+json",
        config: { size: 7_000, digest: "sha256:cfg" },
        layers: [
          { size: 30_000_000, digest: "sha256:a" },
          { size: 12_345, digest: "sha256:b" },
        ],
      }),
    ).toBe(30_019_345);
  });

  it("returns undefined for multi-arch indexes (no honest single size)", () => {
    expect(
      imageSizeFromManifest({
        schemaVersion: 2,
        mediaType: "application/vnd.oci.image.index.v1+json",
        manifests: [{ digest: "sha256:x", size: 1_234 }],
      }),
    ).toBeUndefined();
  });

  it("returns undefined for malformed bodies", () => {
    expect(imageSizeFromManifest(null)).toBeUndefined();
    expect(imageSizeFromManifest({ layers: [{ size: "big" }] })).toBeUndefined();
  });
});

describe("page limit", () => {
  it("keeps the browser a picker, not a mirror", () => {
    expect(TAG_PAGE_LIMIT).toBeLessThanOrEqual(50);
  });
});
