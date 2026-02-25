import { describe, it, expect, vi, beforeEach } from "vitest";
import { NixpacksBuilder } from "../adapters/nixpacks";
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
  resourceId: "svc-123",
  deploymentNumber: 1,
  env: { NODE_ENV: "production" },
};

describe("NixpacksBuilder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tagImage).mockResolvedValue(Result.ok(undefined));
  });

  it("builds successfully with correct nixpacks arguments", async () => {
    vi.mocked(runCommand).mockResolvedValue({
      exitCode: 0,
      stdout: "Building...\nDone!\n",
      stderr: "",
    });

    const builder = new NixpacksBuilder();
    const result = await builder.build(baseInput);

    expect(result.isOk()).toBe(true);
    const output = result.unwrap();
    expect(output.imageName).toBe("otterstack-svc-123");
    expect(output.imageTag).toBe("v1");
    expect(output.logs).toContain("Building...");
    expect(output.logs).toContain("Done!");
    expect(output.durationMs).toBeGreaterThanOrEqual(0);

    expect(runCommand).toHaveBeenCalledWith(
      expect.arrayContaining(["nixpacks", "build", "/tmp/test-app", "--name", "otterstack-svc-123:v1"]),
      expect.objectContaining({ timeout: 600_000 }),
    );
  });

  it("passes --no-cache when force is true", async () => {
    vi.mocked(runCommand).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    const builder = new NixpacksBuilder();
    await builder.build({ ...baseInput, force: true });

    expect(runCommand).toHaveBeenCalledWith(
      expect.arrayContaining(["--no-cache"]),
      expect.any(Object),
    );
  });

  it("passes build and start command overrides", async () => {
    vi.mocked(runCommand).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    const builder = new NixpacksBuilder();
    await builder.build({
      ...baseInput,
      buildCommand: "npm run build",
      startCommand: "npm start",
    });

    expect(runCommand).toHaveBeenCalledWith(
      expect.arrayContaining(["--build-cmd", "npm run build", "--start-cmd", "npm start"]),
      expect.any(Object),
    );
  });

  it("returns error when nixpacks exits with non-zero code", async () => {
    vi.mocked(runCommand).mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "Error: build failed\n",
    });

    const builder = new NixpacksBuilder();
    const result = await builder.build(baseInput);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("exit code 1");
    }
  });
});
