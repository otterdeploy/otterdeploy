import { describe, it, expect, vi, beforeEach } from "vitest";
import { DockerImageBuilder } from "../adapters/docker-image";
import type { BuildInput } from "../types";

vi.mock("@otterdeploy/docker", () => ({
  pullImage: vi.fn(),
  tagImage: vi.fn(),
}));

vi.mock("@otterdeploy/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { pullImage, tagImage } from "@otterdeploy/docker";
import { Result } from "better-result";

const baseInput: BuildInput = {
  sourceDir: "nginx:1.25",
  resourceId: "svc-789",
  deploymentNumber: 2,
  env: {},
};

describe("DockerImageBuilder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pulls and tags image successfully", async () => {
    vi.mocked(pullImage).mockResolvedValue(Result.ok("nginx:1.25"));
    vi.mocked(tagImage).mockResolvedValue(Result.ok(undefined));

    const builder = new DockerImageBuilder();
    const result = await builder.build(baseInput);

    expect(result.isOk()).toBe(true);
    const output = result.unwrap();
    expect(output.imageName).toBe("otterstack-svc-789");
    expect(output.imageTag).toBe("v2");
    expect(output.durationMs).toBeGreaterThanOrEqual(0);
    expect(output.logs).toContain("Pulling image: nginx:1.25");

    expect(pullImage).toHaveBeenCalledWith("nginx:1.25");
    expect(tagImage).toHaveBeenCalledWith("nginx:1.25", "otterstack-svc-789:v2");
    expect(tagImage).toHaveBeenCalledWith("nginx:1.25", "otterstack-svc-789:latest");
  });

  it("returns error when pull fails", async () => {
    vi.mocked(pullImage).mockResolvedValue(Result.err(new Error("pull failed")));

    const builder = new DockerImageBuilder();
    const result = await builder.build(baseInput);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe("pull failed");
    }
  });

  it("returns error when versioned tag fails", async () => {
    vi.mocked(pullImage).mockResolvedValue(Result.ok("nginx:1.25"));
    vi.mocked(tagImage).mockResolvedValueOnce(Result.err(new Error("tag failed")));

    const builder = new DockerImageBuilder();
    const result = await builder.build(baseInput);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe("tag failed");
    }
  });

  it("succeeds even if latest tag fails", async () => {
    vi.mocked(pullImage).mockResolvedValue(Result.ok("nginx:1.25"));
    vi.mocked(tagImage)
      .mockResolvedValueOnce(Result.ok(undefined)) // versioned tag succeeds
      .mockResolvedValueOnce(Result.err(new Error("latest tag failed"))); // latest tag fails

    const builder = new DockerImageBuilder();
    const result = await builder.build(baseInput);

    expect(result.isOk()).toBe(true);
  });
});
