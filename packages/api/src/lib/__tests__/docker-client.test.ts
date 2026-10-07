/**
 * Request-path Docker clients are bounded by default: this pins the default
 * the product ships when nothing overrides it.
 */
import { describe, expect, it } from "vite-plus/test";

import { DOCKER_REQUEST_TIMEOUT_MS, dockerRequestTimeoutMs } from "../docker-client";

describe("request Docker client timeout", () => {
  it("defaults to DOCKER_REQUEST_TIMEOUT_MS, well inside the 120s procedure deadline", () => {
    expect(dockerRequestTimeoutMs()).toBe(DOCKER_REQUEST_TIMEOUT_MS);
    expect(DOCKER_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DOCKER_REQUEST_TIMEOUT_MS).toBeLessThan(120_000);
  });
});
