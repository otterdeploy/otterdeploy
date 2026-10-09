/**
 * A service whose ref is a full commit id builds from that commit.
 *
 * `git clone --branch <sha>` fails ("Remote branch ... not found"), and the
 * clone always passed the ref to `--branch`, so pinning a service to a commit
 * (an app pinned to its release commit, say) could not build at all.
 * Runs real git against a local repository: the assertion is what the work
 * tree holds afterwards.
 */
import { createId, ID_PREFIX } from "@otterdeploy/shared/id";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LogSink } from "../log-stream";

const root = mkdtempSync(join(tmpdir(), "clone-test-"));
// oxlint-disable-next-line node/no-process-env -- test env setup boundary: the work dir lands under the data folder, read when paths.ts loads
process.env.OTTERDEPLOY_DATA_DIR = join(root, "data");
const { cloneRepoAtSha } = await import("../clone");

const repo = join(root, "upstream");

function git(args: string[], cwd = repo): string {
  const r = Bun.spawnSync(["git", ...args], { cwd, stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

function commit(content: string): string {
  writeFileSync(join(repo, "VERSION"), content);
  git(["add", "VERSION"]);
  git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", content]);
  return git(["rev-parse", "HEAD"]);
}

const lines: string[] = [];
const sink: LogSink = {
  write: (_stream, line) => lines.push(line),
  system: (line) => lines.push(line),
  setPhase: () => {},
  close: async () => {},
};

let release = "";
beforeAll(() => {
  Bun.spawnSync(["mkdir", "-p", repo]);
  git(["init", "-q", "-b", "main"]);
  release = commit("1.0.0");
  commit("2.0.0-dev");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("cloneRepoAtSha", () => {
  test("a full commit id as the ref checks out that commit, not the branch tip", async () => {
    const { workDir } = await cloneRepoAtSha({
      cloneUrl: `file://${repo}`,
      // What a manifest apply records for `branch: <sha>` (manifest-apply-git).
      ref: `refs/heads/${release}`,
      sha: release,
      projectId: createId(ID_PREFIX.project),
      deploymentId: createId(ID_PREFIX.deployment),
      installationToken: "",
      sink,
    });
    expect(readFileSync(join(workDir, "VERSION"), "utf8")).toBe("1.0.0");
    expect(git(["rev-parse", "HEAD"], workDir)).toBe(release);
  });

  test("a bare commit id as the ref checks out that commit too", async () => {
    const { workDir } = await cloneRepoAtSha({
      cloneUrl: `file://${repo}`,
      ref: release,
      sha: release,
      projectId: createId(ID_PREFIX.project),
      deploymentId: createId(ID_PREFIX.deployment),
      installationToken: "",
      sink,
    });
    expect(git(["rev-parse", "HEAD"], workDir)).toBe(release);
  });

  test("a branch ref still clones the branch and pins the pushed commit", async () => {
    const { workDir } = await cloneRepoAtSha({
      cloneUrl: `file://${repo}`,
      ref: "refs/heads/main",
      sha: release,
      projectId: createId(ID_PREFIX.project),
      deploymentId: createId(ID_PREFIX.deployment),
      installationToken: "",
      sink,
    });
    expect(git(["rev-parse", "HEAD"], workDir)).toBe(release);
  });
});
