import { afterEach, describe, expect, test } from "bun:test";

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { dockerfileBuildArgs, resolveDockerfileBuild } from "../dockerfile";

const tmpDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "otter-dockerfile-test-"));
  tmpDirs.push(dir);
  return dir;
}

function writeFile(dir: string, rel: string, contents = "FROM scratch\n"): void {
  const path = join(dir, rel);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, contents);
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveDockerfileBuild", () => {
  test("dockerfile + default Dockerfile present → dockerfile", () => {
    const workDir = tempDir();
    writeFile(workDir, "Dockerfile");
    const res = resolveDockerfileBuild({
      builder: "dockerfile",
      dockerfilePath: null,
      workDir,
      sourceSubdir: null,
    });
    expect(res.kind).toBe("dockerfile");
    if (res.kind !== "dockerfile") throw new Error("unreachable");
    expect(res.dockerfilePath).toBe(resolve(workDir, "Dockerfile"));
    expect(res.contextDir).toBe(workDir);
    expect(res.relativePath).toBe("Dockerfile");
    expect(res.warnings).toEqual([]);
  });

  test("dockerfile + custom subpath present → dockerfile at that path", () => {
    const workDir = tempDir();
    writeFile(workDir, "docker/prod.Dockerfile");
    const res = resolveDockerfileBuild({
      builder: "dockerfile",
      dockerfilePath: "docker/prod.Dockerfile",
      workDir,
      sourceSubdir: null,
    });
    expect(res.kind).toBe("dockerfile");
    if (res.kind !== "dockerfile") throw new Error("unreachable");
    expect(res.dockerfilePath).toBe(resolve(workDir, "docker/prod.Dockerfile"));
    expect(res.relativePath).toBe("docker/prod.Dockerfile");
  });

  test("dockerfile + missing file → throws", () => {
    const workDir = tempDir();
    expect(() =>
      resolveDockerfileBuild({
        builder: "dockerfile",
        dockerfilePath: null,
        workDir,
        sourceSubdir: null,
      }),
    ).toThrow(/was not found/);
  });

  test("dockerfile + absolute path → throws", () => {
    const workDir = tempDir();
    expect(() =>
      resolveDockerfileBuild({
        builder: "dockerfile",
        dockerfilePath: "/etc/Dockerfile",
        workDir,
        sourceSubdir: null,
      }),
    ).toThrow(/must be relative/);
  });

  test("dockerfile + ../escape path → throws", () => {
    const workDir = tempDir();
    expect(() =>
      resolveDockerfileBuild({
        builder: "dockerfile",
        dockerfilePath: "../outside.Dockerfile",
        workDir,
        sourceSubdir: null,
      }),
    ).toThrow(/outside the repository/);
  });

  test("auto + Dockerfile present → dockerfile", () => {
    const workDir = tempDir();
    writeFile(workDir, "Dockerfile");
    const res = resolveDockerfileBuild({
      builder: "auto",
      dockerfilePath: null,
      workDir,
      sourceSubdir: null,
    });
    expect(res.kind).toBe("dockerfile");
  });

  test("auto + Dockerfile absent → railpack", () => {
    const workDir = tempDir();
    const res = resolveDockerfileBuild({
      builder: "auto",
      dockerfilePath: null,
      workDir,
      sourceSubdir: null,
    });
    expect(res.kind).toBe("railpack");
    expect(res.warnings).toEqual([]);
  });

  test("auto + custom path missing → railpack + warning", () => {
    const workDir = tempDir();
    const res = resolveDockerfileBuild({
      builder: "auto",
      dockerfilePath: "missing.Dockerfile",
      workDir,
      sourceSubdir: null,
    });
    expect(res.kind).toBe("railpack");
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toMatch(/was not found; falling back to Railpack/);
  });

  test("railpack + Dockerfile present → railpack + pinned warning", () => {
    const workDir = tempDir();
    writeFile(workDir, "Dockerfile");
    const res = resolveDockerfileBuild({
      builder: "railpack",
      dockerfilePath: null,
      workDir,
      sourceSubdir: null,
    });
    expect(res.kind).toBe("railpack");
    expect(res.warnings).toEqual([
      "A Dockerfile is present, but this service is pinned to Railpack. Set the build method to Auto or Dockerfile to use it.",
    ]);
  });

  test("sourceSubdir honored: Dockerfile only in apps/api + subdir apps/api → dockerfile there", () => {
    const workDir = tempDir();
    writeFile(workDir, "apps/api/Dockerfile");
    const res = resolveDockerfileBuild({
      builder: "auto",
      dockerfilePath: null,
      workDir,
      sourceSubdir: "apps/api",
    });
    expect(res.kind).toBe("dockerfile");
    if (res.kind !== "dockerfile") throw new Error("unreachable");
    expect(res.dockerfilePath).toBe(resolve(workDir, "apps/api/Dockerfile"));
    expect(res.contextDir).toBe(join(workDir, "apps/api"));
  });

  test("sourceSubdir null + no root Dockerfile → railpack (subdir one ignored)", () => {
    const workDir = tempDir();
    writeFile(workDir, "apps/api/Dockerfile");
    const res = resolveDockerfileBuild({
      builder: "auto",
      dockerfilePath: null,
      workDir,
      sourceSubdir: null,
    });
    expect(res.kind).toBe("railpack");
  });
});

describe("dockerfileBuildArgs", () => {
  test("renders -f, --load, both tags, and context dir", () => {
    const args = dockerfileBuildArgs({
      dockerfilePath: "/work/Dockerfile",
      contextDir: "/work",
      shaTag: "ghcr.io/acme/web:abc123",
      latestTag: "ghcr.io/acme/web:latest",
    });
    expect(args).toEqual([
      "buildx",
      "build",
      "-f",
      "/work/Dockerfile",
      "--load",
      "--progress",
      "plain",
      "-t",
      "ghcr.io/acme/web:abc123",
      "-t",
      "ghcr.io/acme/web:latest",
      "/work",
    ]);
  });

  test("renders --build-arg for a non-empty map, before the context dir", () => {
    const args = dockerfileBuildArgs({
      dockerfilePath: "/work/Dockerfile",
      contextDir: "/work",
      shaTag: "repo:sha",
      latestTag: "repo:latest",
      buildArgs: { NODE_ENV: "production", FOO: "bar" },
    });
    expect(args).toContain("--build-arg");
    expect(args).toContain("NODE_ENV=production");
    expect(args).toContain("FOO=bar");
    // context dir stays last
    expect(args[args.length - 1]).toBe("/work");
    // each --build-arg is immediately followed by its K=V
    const nodeIdx = args.indexOf("NODE_ENV=production");
    expect(args[nodeIdx - 1]).toBe("--build-arg");
  });

  test("preserves values verbatim — equals signs, spaces, empty", () => {
    const args = dockerfileBuildArgs({
      dockerfilePath: "/work/Dockerfile",
      contextDir: "/work",
      shaTag: "repo:sha",
      latestTag: "repo:latest",
      // Values are passed as a single argv entry (no shell), so `=`, spaces,
      // and empty values are safe — they reach docker exactly as typed.
      buildArgs: { DSN: "a=b=c", FLAGS: "  --opt x  ", EMPTY: "" },
    });
    expect(args).toContain("DSN=a=b=c");
    expect(args).toContain("FLAGS=  --opt x  ");
    expect(args).toContain("EMPTY=");
    // still one argv entry per build-arg, flag then K=V
    const dsnIdx = args.indexOf("DSN=a=b=c");
    expect(args[dsnIdx - 1]).toBe("--build-arg");
  });

  test("omits build-arg flags entirely for an empty / unset map", () => {
    const base = {
      dockerfilePath: "/work/Dockerfile",
      contextDir: "/work",
      shaTag: "repo:sha",
      latestTag: "repo:latest",
    };
    expect(dockerfileBuildArgs(base)).not.toContain("--build-arg");
    expect(dockerfileBuildArgs({ ...base, buildArgs: {} })).not.toContain(
      "--build-arg",
    );
  });

  const cacheBase = {
    dockerfilePath: "/work/Dockerfile",
    contextDir: "/work",
    shaTag: "repo:sha",
    latestTag: "repo:latest",
  };

  test("adds --builder + local cache flags when a cache builder is set", () => {
    const args = dockerfileBuildArgs({
      ...cacheBase,
      builderName: "otterdeploy-cache",
      cachePath: "/data/otterdeploy/buildx-cache/repo",
    });
    // --builder comes right after `buildx build`
    expect(args.slice(0, 4)).toEqual([
      "buildx",
      "build",
      "--builder",
      "otterdeploy-cache",
    ]);
    expect(args).toContain("--cache-from");
    expect(args).toContain("type=local,src=/data/otterdeploy/buildx-cache/repo");
    expect(args).toContain("--cache-to");
    expect(args).toContain(
      "type=local,dest=/data/otterdeploy/buildx-cache/repo,mode=max",
    );
    // context dir stays last
    expect(args[args.length - 1]).toBe("/work");
  });

  test("emits NO cache/builder flags without a builder (default driver)", () => {
    // The default docker driver rejects cache export — flags must be absent.
    const noBuilder = dockerfileBuildArgs({
      ...cacheBase,
      cachePath: "/data/otterdeploy/buildx-cache/repo",
    });
    expect(noBuilder).not.toContain("--builder");
    expect(noBuilder).not.toContain("--cache-from");
    expect(noBuilder).not.toContain("--cache-to");
    // byte-identical to the no-cache-args form
    expect(noBuilder).toEqual(dockerfileBuildArgs(cacheBase));
  });
});
