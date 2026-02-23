import { describe, it, expect, vi, beforeEach } from "vitest";
import { DockerfileBuilder } from "../adapters/dockerfile";
import type { BuildInput } from "../types";

vi.mock("@otterdeploy/docker", () => ({
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

vi.mock("../spawn", () => ({
  runCommand: vi.fn(),
}));

import { tagImage } from "@otterdeploy/docker";
import { runCommand } from "../spawn";
import { Result } from "better-result";

const baseInput: BuildInput = {
  sourceDir: "/tmp/test-app",
  resourceId: "svc-456",
  deploymentNumber: 3,
  env: {},
};

describe("DockerfileBuilder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tagImage).mockResolvedValue(Result.ok(undefined));
  });

  it("builds successfully with default Dockerfile path", async () => {
    vi.mocked(runCommand).mockResolvedValue({
      exitCode: 0,
      stdout: "Step 1/5\nStep 2/5\n",
      stderr: "",
    });

    const builder = new DockerfileBuilder();
    const result = await builder.build(baseInput);

    expect(result.isOk()).toBe(true);
    const output = result.unwrap();
    expect(output.imageName).toBe("otterstack-svc-456");
    expect(output.imageTag).toBe("v3");
    expect(output.durationMs).toBeGreaterThanOrEqual(0);

    expect(runCommand).toHaveBeenCalledWith(
      expect.arrayContaining(["docker", "build", "-f", "Dockerfile", "-t", "otterstack-svc-456:v3"]),
      expect.objectContaining({ timeout: 600_000 }),
    );
  });

  it("uses custom dockerfilePath when provided", async () => {
    vi.mocked(runCommand).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    const builder = new DockerfileBuilder();
    await builder.build({ ...baseInput, dockerfilePath: "deploy/Dockerfile.prod" });

    expect(runCommand).toHaveBeenCalledWith(
      expect.arrayContaining(["-f", "deploy/Dockerfile.prod"]),
      expect.any(Object),
    );
  });

  it("passes --no-cache when force is true", async () => {
    vi.mocked(runCommand).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    const builder = new DockerfileBuilder();
    await builder.build({ ...baseInput, force: true });

    expect(runCommand).toHaveBeenCalledWith(
      expect.arrayContaining(["--no-cache"]),
      expect.any(Object),
    );
  });

  it("passes build args correctly", async () => {
    vi.mocked(runCommand).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    const builder = new DockerfileBuilder();
    await builder.build({
      ...baseInput,
      buildArgs: { APP_VERSION: "1.0.0", DEBUG: "false" },
    });

    expect(runCommand).toHaveBeenCalledWith(
      expect.arrayContaining(["--build-arg", "APP_VERSION=1.0.0", "--build-arg", "DEBUG=false"]),
      expect.any(Object),
    );
  });

  it("returns error when docker build exits with non-zero code", async () => {
    vi.mocked(runCommand).mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "Error response from daemon\n",
    });

    const builder = new DockerfileBuilder();
    const result = await builder.build(baseInput);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("exit code 1");
    }
  });
});
