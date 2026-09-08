/**
 * od-71bq: a builder that cannot reach a registry must not read as a broken
 * Dockerfile.
 *
 * The two failing directions matter equally, so both are pinned. Missing a
 * real infrastructure failure sends the operator to debug their Dockerfile
 * (three builds and a detour through GHCR, on the deploy that reported this).
 * Firing on an ordinary build failure tells them their Dockerfile is fine when
 * it is not, which is the same disease pointing the other way.
 */
import { describe, expect, it } from "vite-plus/test";

import { classifyInfraFailure } from "../build-infra-failure";

// The verbatim tail from the report.
const REPORTED = `
#2 [internal] load metadata for docker.io/oven/bun:1
ERROR: failed to do request: Head "https://registry-1.docker.io/v2/oven/bun/manifests/1":
       dial tcp: lookup registry-1.docker.io: i/o timeout
ERROR: failed to solve: DeadlineExceeded: oven/bun:1
`;

describe("classifyInfraFailure", () => {
  it("classifies the reported Docker Hub resolution timeout", () => {
    const result = classifyInfraFailure(REPORTED);
    expect(result).not.toBeNull();
    expect(result?.summary).toContain("infrastructure problem");
    expect(result?.remedy).toContain("otterdeploy-cache");
  });

  it("classifies the same failure against other registries", () => {
    const ghcr = classifyInfraFailure(
      `#2 [internal] load metadata for ghcr.io/acme/base:1\n` +
        `ERROR: failed to solve: failed to do request: Head "https://ghcr.io/v2/acme/base/manifests/1": dial tcp: lookup ghcr.io: no such host`,
    );
    expect(ghcr).not.toBeNull();
  });

  it("does not fire on an ordinary Dockerfile failure", () => {
    const copyFailure = `
#8 [builder 4/9] COPY package.json ./
#8 ERROR: failed to compute cache key: "/package.json" not found
ERROR: failed to solve: failed to compute cache key
`;
    expect(classifyInfraFailure(copyFailure)).toBeNull();
  });

  it("does not fire when the app's own build output mentions a timeout", () => {
    // A RUN step is not the metadata phase, and the user's own logs must not
    // be reclassified as a platform fault just for containing the words.
    const appOutput = `
#12 [builder 7/9] RUN bun run build
#12 1.234 warning: request to https://registry-1.docker.io timed out, retrying
#12 45.6 error: Type error in src/index.ts
ERROR: process "/bin/sh -c bun run build" did not complete successfully: exit code: 1
`;
    expect(classifyInfraFailure(appOutput)).toBeNull();
  });

  it("does not fire on a resolution error with no registry host in it", () => {
    expect(
      classifyInfraFailure(
        `#2 [internal] load metadata\nERROR: failed to solve: dial tcp: lookup internal.corp: no such host`,
      ),
    ).toBeNull();
  });

  it("returns null for empty output", () => {
    expect(classifyInfraFailure("")).toBeNull();
  });
});
