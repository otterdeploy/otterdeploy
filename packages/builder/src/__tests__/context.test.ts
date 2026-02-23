import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prepareBuildContext } from "../context";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("@otterdeploy/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("prepareBuildContext", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "builder-ctx-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns the source directory when no rootDirectory is specified", async () => {
    const result = await prepareBuildContext(tempDir);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe(tempDir);
  });

  it("injects default .dockerignore when not present", async () => {
    const result = await prepareBuildContext(tempDir);

    expect(result.isOk()).toBe(true);
    const content = await readFile(join(tempDir, ".dockerignore"), "utf-8");
    expect(content).toContain(".git");
    expect(content).toContain("node_modules");
    expect(content).toContain(".env");
  });

  it("does not overwrite existing .dockerignore", async () => {
    const customContent = "custom-ignore\n";
    await writeFile(join(tempDir, ".dockerignore"), customContent, "utf-8");

    const result = await prepareBuildContext(tempDir);

    expect(result.isOk()).toBe(true);
    const content = await readFile(join(tempDir, ".dockerignore"), "utf-8");
    expect(content).toBe(customContent);
  });

  it("resolves rootDirectory to subdirectory", async () => {
    const subDir = join(tempDir, "app");
    await mkdir(subDir);

    const result = await prepareBuildContext(tempDir, "app");

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe(subDir);
  });

  it("returns error when rootDirectory does not exist", async () => {
    const result = await prepareBuildContext(tempDir, "nonexistent");

    expect(result.isErr()).toBe(true);
  });
});
