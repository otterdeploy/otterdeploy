import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  analyzeCopySources,
  contextFailureHint,
  joinInstructions,
  parseCopySources,
  resolveDockerfileContext,
  rootIsWorkspaceSync,
} from "../dockerfile-context";

const tmpDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "otter-dfctx-test-"));
  tmpDirs.push(dir);
  return dir;
}

function writeFile(dir: string, rel: string, contents = "x\n"): void {
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

describe("joinInstructions", () => {
  test("joins line continuations and drops comments", () => {
    const text = [
      "# syntax=docker/dockerfile:1",
      "COPY a.txt \\",
      "    b.txt \\",
      "    ./",
      "RUN ls",
    ].join("\n");
    expect(joinInstructions(text)).toEqual(["COPY a.txt b.txt ./", "RUN ls"]);
  });

  test("a comment inside a continuation does not terminate it", () => {
    const text = ["COPY a.txt \\", "# a note", "    ./", ""].join("\n");
    expect(joinInstructions(text)).toEqual(["COPY a.txt ./"]);
  });
});

describe("parseCopySources", () => {
  test("drops the destination and keeps every source", () => {
    expect(parseCopySources("COPY package.json bun.lock ./")).toEqual(["package.json", "bun.lock"]);
  });

  test("ignores --from copies (another stage, not the context)", () => {
    expect(parseCopySources("COPY --from=builder /app/dist ./dist")).toEqual([]);
  });

  test("consumes --chown/--chmod flags before the sources", () => {
    expect(parseCopySources("COPY --chown=node:node --chmod=755 src/ ./src/")).toEqual(["src/"]);
  });

  test("handles the JSON array form", () => {
    expect(parseCopySources('COPY ["a b.txt", "./dest/"]')).toEqual(["a b.txt"]);
  });

  test("skips heredoc bodies and remote ADD sources", () => {
    expect(parseCopySources("COPY <<EOF /app/x\nhello\nEOF")).toEqual([]);
    expect(parseCopySources("ADD https://example.com/x.tar.gz /tmp/")).toEqual([]);
  });

  test("is case-insensitive on the instruction", () => {
    expect(parseCopySources("copy turbo.json ./")).toEqual(["turbo.json"]);
  });
});

describe("analyzeCopySources", () => {
  test("flags sources that resolve only from the repo root", () => {
    const workDir = tempDir();
    writeFile(workDir, "bun.lock");
    writeFile(workDir, "apps/web/package.json");
    writeFile(workDir, "packages/ui/package.json");

    const analysis = analyzeCopySources({
      text: "COPY package.json bun.lock ./\nCOPY packages/ ./packages/\n",
      workDir,
      appDir: join(workDir, "apps/web"),
    });
    // package.json exists under apps/web, so only the root-only ones are flagged.
    expect(analysis.rootOnly.sort()).toEqual(["bun.lock", "packages/"]);
    expect(analysis.unresolved).toEqual([]);
  });

  test("a source missing everywhere is unresolved, not a root escalation", () => {
    const workDir = tempDir();
    writeFile(workDir, "apps/web/package.json");
    const analysis = analyzeCopySources({
      text: "COPY nope.txt ./",
      workDir,
      appDir: join(workDir, "apps/web"),
    });
    expect(analysis.rootOnly).toEqual([]);
    expect(analysis.unresolved).toEqual(["nope.txt"]);
  });
});

describe("resolveDockerfileContext", () => {
  function turborepo(): { workDir: string; appDir: string } {
    const workDir = tempDir();
    writeFile(workDir, "package.json", JSON.stringify({ workspaces: ["apps/*", "packages/*"] }));
    writeFile(workDir, "bun.lock");
    writeFile(workDir, "turbo.json", "{}");
    writeFile(workDir, "apps/web/package.json", JSON.stringify({ name: "@acme/web" }));
    writeFile(workDir, "packages/ui/package.json");
    return { workDir, appDir: join(workDir, "apps/web") };
  }

  test("auto escalates to the repo root for a monorepo Dockerfile", () => {
    const { workDir, appDir } = turborepo();
    const res = resolveDockerfileContext({
      mode: "auto",
      workDir,
      appDir,
      dockerfileText: "FROM oven/bun\nCOPY package.json bun.lock ./\nCOPY packages/ ./packages/\n",
      rootIsWorkspace: true,
    });
    expect(res.contextDir).toBe(workDir);
    expect(res.note).toContain("repository root");
  });

  test("auto leaves a self-contained subdir Dockerfile alone", () => {
    const { workDir, appDir } = turborepo();
    writeFile(workDir, "apps/web/bun.lock");
    const res = resolveDockerfileContext({
      mode: "auto",
      workDir,
      appDir,
      dockerfileText: "FROM oven/bun\nCOPY package.json bun.lock ./\n",
      rootIsWorkspace: true,
    });
    expect(res.contextDir).toBe(appDir);
    expect(res.note).toBeNull();
  });

  test("auto never escalates outside a workspace", () => {
    const { workDir, appDir } = turborepo();
    const res = resolveDockerfileContext({
      mode: "auto",
      workDir,
      appDir,
      dockerfileText: "COPY bun.lock ./",
      rootIsWorkspace: false,
    });
    expect(res.contextDir).toBe(appDir);
  });

  test("subdir and root pin the choice regardless of the Dockerfile", () => {
    const { workDir, appDir } = turborepo();
    const text = "COPY package.json bun.lock ./";
    expect(
      resolveDockerfileContext({
        mode: "subdir",
        workDir,
        appDir,
        dockerfileText: text,
        rootIsWorkspace: true,
      }).contextDir,
    ).toBe(appDir);
    expect(
      resolveDockerfileContext({
        mode: "root",
        workDir,
        appDir,
        dockerfileText: text,
        rootIsWorkspace: true,
      }).contextDir,
    ).toBe(workDir);
  });

  test("an unreadable Dockerfile degrades to the subdir context", () => {
    const { workDir, appDir } = turborepo();
    const res = resolveDockerfileContext({
      mode: "auto",
      workDir,
      appDir,
      dockerfileText: null,
      rootIsWorkspace: true,
    });
    expect(res.contextDir).toBe(appDir);
  });

  test("no subdir collapses every mode to the repo root", () => {
    const workDir = tempDir();
    for (const mode of ["auto", "subdir", "root"] as const) {
      const res = resolveDockerfileContext({
        mode,
        workDir,
        appDir: workDir,
        dockerfileText: "COPY . .",
        rootIsWorkspace: true,
      });
      expect(res.contextDir).toBe(workDir);
      expect(res.note).toBeNull();
    }
  });
});

describe("rootIsWorkspaceSync", () => {
  test("detects the array workspaces field", () => {
    const dir = tempDir();
    writeFile(dir, "package.json", JSON.stringify({ workspaces: ["apps/*"] }));
    expect(rootIsWorkspaceSync(dir)).toBe(true);
  });

  test("detects bun's object form and pnpm-workspace.yaml", () => {
    const objDir = tempDir();
    writeFile(objDir, "package.json", JSON.stringify({ workspaces: { packages: ["apps/*"] } }));
    expect(rootIsWorkspaceSync(objDir)).toBe(true);

    const pnpmDir = tempDir();
    writeFile(pnpmDir, "pnpm-workspace.yaml", "packages:\n  - apps/*\n");
    expect(rootIsWorkspaceSync(pnpmDir)).toBe(true);
  });

  test("a plain repo, an empty workspaces array, and malformed JSON are all false", () => {
    const plain = tempDir();
    writeFile(plain, "package.json", JSON.stringify({ name: "x" }));
    expect(rootIsWorkspaceSync(plain)).toBe(false);

    const empty = tempDir();
    writeFile(empty, "package.json", JSON.stringify({ workspaces: [] }));
    expect(rootIsWorkspaceSync(empty)).toBe(false);

    const broken = tempDir();
    writeFile(broken, "package.json", "{ not json");
    expect(rootIsWorkspaceSync(broken)).toBe(false);

    expect(rootIsWorkspaceSync(tempDir())).toBe(false);
  });
});

describe("contextFailureHint", () => {
  test("names the fix when a subdir-context build fails on a COPY", () => {
    const hint = contextFailureHint({
      tail: 'failed to compute cache key: "/bun.lock": not found',
      contextDir: "/w/apps/web",
      workDir: "/w",
      subdir: "apps/web",
    });
    expect(hint).toContain("Repository root");
  });

  test("suggests the opposite direction when already at the root", () => {
    const hint = contextFailureHint({
      tail: "not found",
      contextDir: "/w",
      workDir: "/w",
      subdir: "apps/web",
    });
    expect(hint).toContain("Root directory");
  });

  test("stays silent for a non-context failure or a subdir-less build", () => {
    expect(
      contextFailureHint({ tail: "npm ERR! oops", contextDir: "/w/a", workDir: "/w", subdir: "a" }),
    ).toBeNull();
    expect(
      contextFailureHint({ tail: "not found", contextDir: "/w", workDir: "/w", subdir: null }),
    ).toBeNull();
  });
});
