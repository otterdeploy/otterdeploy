/**
 * Clone a repo at a specific commit into a tmpfs work dir.
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

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { LogSink } from "./log-stream";
import { runProcess } from "./run-process";

export interface CloneResult {
  /** Absolute path of the work tree. Caller is responsible for cleanup. */
  workDir: string;
}

export async function cloneRepoAtSha(opts: {
  cloneUrl: string;
  ref: string;
  sha: string;
  /** Empty string when cloning a public repo — no token to inject. */
  installationToken: string;
  sink: LogSink;
}): Promise<CloneResult> {
  const workDir = await mkdtemp(path.join(tmpdir(), "otterbuild-"));
  const url = opts.installationToken
    ? injectToken(opts.cloneUrl, opts.installationToken)
    : opts.cloneUrl;
  // Don't register an empty string as a secret — LogSink would mask
  // every empty stretch of output.
  const secrets = opts.installationToken ? [opts.installationToken] : [];

  opts.sink.system(`cloning ${opts.cloneUrl} @ ${opts.ref} (${opts.sha.slice(0, 7)}) → ${workDir}`);

  const clone = await runProcess({
    cmd: "git",
    args: [
      "clone",
      "--depth",
      "1",
      "--branch",
      stripRefsHeadsPrefix(opts.ref),
      url,
      workDir,
    ],
    sink: opts.sink,
    secrets,
  });
  if (clone.exitCode !== 0) {
    throw new Error(`git clone failed (exit ${clone.exitCode}): ${truncate(clone.tail, 500)}`);
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
    throw new Error(`git reset --hard ${opts.sha} failed (exit ${reset.exitCode}): ${truncate(reset.tail, 500)}`);
  }

  return { workDir };
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
