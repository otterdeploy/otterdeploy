import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StaticBuilder } from "../adapters/static";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

describe("StaticBuilder", () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(tagImage).mockResolvedValue(Result.ok(undefined));
    tempDir = await mkdtemp(join(tmpdir(), "builder-static-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("generates Dockerfile and Caddyfile in SPA mode by default", async () => {
    vi.mocked(runCommand).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    const input: BuildInput = {
      sourceDir: tempDir,
      resourceId: "static-1",
      deploymentNumber: 1,
      env: {},
    };

    const builder = new StaticBuilder();
    const result = await builder.build(input);

    expect(result.isOk()).toBe(true);
    const output = result.unwrap();
    expect(output.imageName).toBe("otterstack-static-1");
    expect(output.imageTag).toBe("v1");

    // Verify generated Dockerfile
    const dockerfile = await readFile(join(tempDir, "Dockerfile"), "utf-8");
    expect(dockerfile).toContain("FROM caddy:2-alpine");
    expect(dockerfile).toContain("COPY Caddyfile /etc/caddy/Caddyfile");

    // Verify Caddyfile has SPA try_files
    const caddyfile = await readFile(join(tempDir, "Caddyfile"), "utf-8");
    expect(caddyfile).toContain("try_files {path} /index.html");
    expect(caddyfile).toContain("file_server");
  });

  it("generates static mode Caddyfile when SPA_MODE is false", async () => {
    vi.mocked(runCommand).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    const input: BuildInput = {
      sourceDir: tempDir,
      resourceId: "static-2",
      deploymentNumber: 1,
      env: {},
      buildArgs: { SPA_MODE: "false" },
    };

    const builder = new StaticBuilder();
    await builder.build(input);

    const caddyfile = await readFile(join(tempDir, "Caddyfile"), "utf-8");
    expect(caddyfile).not.toContain("try_files");
    expect(caddyfile).toContain("file_server");
  });

  it("passes --no-cache when force is true", async () => {
    vi.mocked(runCommand).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    const input: BuildInput = {
      sourceDir: tempDir,
      resourceId: "static-3",
      deploymentNumber: 1,
      env: {},
      force: true,
    };

    const builder = new StaticBuilder();
    await builder.build(input);

    expect(runCommand).toHaveBeenCalledWith(
      expect.arrayContaining(["--no-cache"]),
      expect.any(Object),
    );
  });

  it("returns error when docker build fails", async () => {
    vi.mocked(runCommand).mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "build error\n",
    });

    const input: BuildInput = {
      sourceDir: tempDir,
      resourceId: "static-4",
      deploymentNumber: 1,
      env: {},
    };

    const builder = new StaticBuilder();
    const result = await builder.build(input);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("exit code 1");
    }
  });
});
