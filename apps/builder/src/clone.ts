/**
 * Clone a repo at a specific commit into a build work dir under the host data
 * folder (`<DATA_ROOT>/builds/<projectId>/<deploymentId>`), falling back to an
 * ephemeral `tmpdir()` when the data folder isn't writable (local dev). See
 * docs/designs/data-folder.md.
 *
 * Tokenization: the installation access token is injected into the URL
 * as the basic-auth username (`https://x-access-token:<token>@github.com/…`).
 * Cloning with `--depth 1 --branch <ref>` then `git fetch <sha>` + `git
 * reset --hard <sha>` gets us the exact commit without pulling history
 * we don't need. (The ref-only depth-1 clone won't always include the
 * pushed SHA if the branch has moved since the webhook fired.)
 *
 * The token is registered as a secret with the LogSink so it never
 * appears in the persisted build output.
 */

import type { DeploymentId, ProjectId } from "@otterdeploy/shared/id";

import { buildDir } from "@otterdeploy/shared/paths";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { LogSink } from "./log-stream";

import { runProcess } from "./run-process";

export interface CloneResult {
  /** Absolute path of the work tree. Caller is responsible for cleanup. */
  workDir: string;
  /** True when the work dir lives under the data folder (so a FAILED build's
   *  clone can be kept for inspection + reclaimed by the TTL sweep). False for
   *  the ephemeral tmpdir fallback, which is always cleaned. */
  persistent: boolean;
}

/**
 * Work dir for a build: `<DATA_ROOT>/builds/<projectId>/<deploymentId>` when the
 * data folder is writable (predictable + inspectable + cap-able), else an ephemeral
 * `tmpdir()` so local dev — where `/data` isn't writable and no
 * `OTTERDEPLOY_DATA_DIR` is set — keeps working unchanged. Either way the dir is
 * empty, which `git clone <url> <dir>` requires.
 */
export async function resolveWorkDir(
  projectId: ProjectId,
  deploymentId: DeploymentId,
): Promise<{ path: string; persistent: boolean }> {
  const preferred = buildDir(projectId, deploymentId);
  try {
    await mkdir(preferred, { recursive: true });
    return { path: preferred, persistent: true };
  } catch {
    return {
      path: await mkdtemp(path.join(tmpdir(), "otterbuild-")),
      persistent: false,
    };
  }
}

export async function cloneRepoAtSha(opts: {
  cloneUrl: string;
  ref: string;
  sha: string;
  /** Groups the build's work dir under its project on disk. */
  projectId: ProjectId;
  /** Names the build's work dir under the data folder. */
  deploymentId: DeploymentId;
  /** Empty string when cloning a public repo — no token to inject. */
  installationToken: string;
  /** How the repo is bound. `github_app` cloning failures point the user at
   *  reconnecting GitHub (a revoked/narrowed install fails the clone here);
   *  `public_url` failures stay generic. Defaults to public_url. */
  bindingKind?: "github_app" | "public_url";
  sink: LogSink;
}): Promise<CloneResult> {
  const { path: workDir, persistent } = await resolveWorkDir(opts.projectId, opts.deploymentId);
  const url = opts.installationToken
    ? injectToken(opts.cloneUrl, opts.installationToken)
    : opts.cloneUrl;
  // Don't register an empty string as a secret — LogSink would mask
  // every empty stretch of output.
  const secrets = opts.installationToken ? [opts.installationToken] : [];

  opts.sink.system(`cloning ${opts.cloneUrl} @ ${opts.ref} (${opts.sha.slice(0, 7)}) → ${workDir}`);

  const clone = await runProcess({
    cmd: "git",
    args: ["clone", "--depth", "1", "--branch", stripRefsHeadsPrefix(opts.ref), url, workDir],
    sink: opts.sink,
    secrets,
  });
  if (clone.exitCode !== 0) {
    const detail = truncate(clone.tail, 500);
    if (opts.bindingKind === "github_app") {
      // A live install whose token minted but whose repo access was narrowed or
      // revoked fails right here — make the remedy explicit instead of leaking a
      // raw "Authentication failed" / "Repository not found" from git.
      throw new Error(
        `git clone failed (exit ${clone.exitCode}) — the GitHub App installation may have lost access to this repository (removed or repo de-selected). Reconnect GitHub in Settings → Git. Details: ${detail}`,
      );
    }
    throw new Error(`git clone failed (exit ${clone.exitCode}): ${detail}`);
  }

  // The pushed SHA may differ from the branch tip if another push landed
  // after the webhook fired. Fetch + reset to pin the exact commit.
  const fetch = await runProcess({
    cmd: "git",
    args: ["fetch", "--depth", "1", "origin", opts.sha],
    cwd: workDir,
    sink: opts.sink,
    secrets,
  });
  if (fetch.exitCode !== 0) {
    // Not fatal: the depth-1 clone already has the branch tip and that's
    // often the same commit. Log it and continue with `git reset` — if
    // the SHA truly isn't reachable that step will fail clearly.
    opts.sink.system(
      `git fetch ${opts.sha.slice(0, 7)} failed (exit ${fetch.exitCode}); falling back to branch tip`,
    );
  }

  const reset = await runProcess({
    cmd: "git",
    args: ["reset", "--hard", opts.sha],
    cwd: workDir,
    sink: opts.sink,
    secrets,
  });
  if (reset.exitCode !== 0) {
    throw new Error(
      `git reset --hard ${opts.sha} failed (exit ${reset.exitCode}): ${truncate(reset.tail, 500)}`,
    );
  }

  return { workDir, persistent };
}

function injectToken(cloneUrl: string, token: string): string {
  // GitHub's clone URL is `https://github.com/owner/repo.git`. Inject as
  // basic-auth username; the literal user "x-access-token" tells GitHub
  // to treat the password as an installation/app token.
  try {
    const u = new URL(cloneUrl);
    u.username = "x-access-token";
    u.password = token;
    return u.toString();
  } catch {
    return cloneUrl;
  }
}

function stripRefsHeadsPrefix(ref: string): string {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}
