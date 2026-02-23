import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildCloneUrl, cloneRepository } from "../clone";

vi.mock("@otterdeploy/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock child_process spawn for clone tests
const mockStdout = { on: vi.fn() };
const mockStderr = { on: vi.fn() };
const mockChild = {
  stdout: mockStdout,
  stderr: mockStderr,
  on: vi.fn(),
};

vi.mock("node:child_process", () => ({
  spawn: vi.fn().mockReturnValue({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
  }),
}));

describe("buildCloneUrl", () => {
  it("builds a public clone URL without token", () => {
    const url = buildCloneUrl("owner", "repo");

    expect(url).toBe("https://github.com/owner/repo.git");
  });

  it("builds a private clone URL with access token", () => {
    const url = buildCloneUrl("owner", "repo", "ghp_token123");

    expect(url).toBe(
      "https://x-access-token:ghp_token123@github.com/owner/repo.git",
    );
  });
});

describe("cloneRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds correct clone command for public repos", async () => {
    const { spawn } = await import("node:child_process");

    // Make spawn simulate a successful clone
    (spawn as ReturnType<typeof vi.fn>).mockImplementation(
      (cmd: string, args: string[]) => {
        const child = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((event: string, cb: Function) => {
            if (event === "close") {
              // Simulate success async
              setTimeout(() => cb(0), 0);
            }
          }),
        };
        return child;
      },
    );

    const resultPromise = cloneRepository({
      owner: "owner",
      name: "repo",
      branch: "main",
      targetDir: "/tmp/clone-test",
    });

    const result = await resultPromise;

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ path: "/tmp/clone-test" });

    expect(spawn).toHaveBeenCalledWith(
      "git",
      [
        "clone",
        "--depth",
        "1",
        "--single-branch",
        "--branch",
        "main",
        "https://github.com/owner/repo.git",
        "/tmp/clone-test",
      ],
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
    );
  });

  it("builds correct clone command for private repos with token", async () => {
    const { spawn } = await import("node:child_process");

    (spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const child = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: Function) => {
          if (event === "close") {
            setTimeout(() => cb(0), 0);
          }
        }),
      };
      return child;
    });

    const result = await cloneRepository({
      owner: "owner",
      name: "private-repo",
      branch: "develop",
      targetDir: "/tmp/private-clone",
      accessToken: "ghp_secret_token",
    });

    expect(result.isOk()).toBe(true);

    expect(spawn).toHaveBeenCalledWith(
      "git",
      [
        "clone",
        "--depth",
        "1",
        "--single-branch",
        "--branch",
        "develop",
        "https://x-access-token:ghp_secret_token@github.com/owner/private-repo.git",
        "/tmp/private-clone",
      ],
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
    );
  });

  it("resolves rootDirectory to subdirectory path", async () => {
    const { spawn } = await import("node:child_process");
    const fs = await import("node:fs/promises");

    (spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const child = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: Function) => {
          if (event === "close") {
            setTimeout(() => cb(0), 0);
          }
        }),
      };
      return child;
    });

    // Create a temp directory to test rootDirectory resolution
    const { mkdtemp, mkdir, rm } = fs;
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const tempDir = await mkdtemp(join(tmpdir(), "git-clone-test-"));
    const subDir = join(tempDir, "apps", "web");
    await mkdir(subDir, { recursive: true });

    try {
      const result = await cloneRepository({
        owner: "owner",
        name: "repo",
        branch: "main",
        targetDir: tempDir,
        rootDirectory: "apps/web",
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().path).toBe(subDir);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns error when rootDirectory does not exist", async () => {
    const { spawn } = await import("node:child_process");
    const fs = await import("node:fs/promises");

    (spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const child = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: Function) => {
          if (event === "close") {
            setTimeout(() => cb(0), 0);
          }
        }),
      };
      return child;
    });

    const { mkdtemp, rm } = fs;
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const tempDir = await mkdtemp(join(tmpdir(), "git-clone-test-"));

    try {
      const result = await cloneRepository({
        owner: "owner",
        name: "repo",
        branch: "main",
        targetDir: tempDir,
        rootDirectory: "nonexistent/subdir",
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain("not found");
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
