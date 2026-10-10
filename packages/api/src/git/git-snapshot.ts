/**
 * Read a PUBLIC repo with git itself: one shallow, blob-less clone gives the
 * whole file tree, and single files are fetched on demand from it.
 *
 * Repo inspection (the deploy wizard's framework / monorepo / env-template
 * detection) used to read everything through GitHub's REST API (a tree call,
 * then a contents call per package.json). An anonymous caller gets 60 requests
 * an hour per IP, and those calls shared that budget with the head lookup and
 * with tenant builds, so a handful of public-repo deploys starved all three.
 * Git has no such budget and is what the builder clones with anyway.
 *
 * `--filter=blob:none` makes the clone cost the commit and its trees only (a
 * few hundred KB even for large repos); a file's blob is fetched the first
 * time it is read. A server that ignores the filter just sends everything.
 *
 * Every function answers "unavailable" rather than throwing: a missing git, a
 * blocked remote or a private repo is a reason to try the API, never a failure.
 */
import { Temporal } from "@otterdeploy/shared/temporal";
import { Result } from "better-result";
import { createHash } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FULL_SHA = /^[0-9a-f]{40}$/;
/** Same rule as ./git-ls-remote.ts: a name git would not read as an option. */
const SAFE_REF = /^[^-\s~^:?*[\\][^\s~^:?*[\\]*$/;
const CLONE_TIMEOUT_MS = 60_000;
const GIT_TIMEOUT_MS = 30_000;
/** A clone younger than this answers further reads; matches the inspector's
 *  in-memory snapshot TTL so a fresh push still surfaces within minutes. */
const CLONE_TTL_MS = 5 * 60_000;
/** Directories older than this are leftovers and are swept. */
const SWEEP_AFTER_MS = 30 * 60_000;
const MAX_FILE_BYTES = 1024 * 1024;
const FETCHED_MARKER = ".otterdeploy-fetched";

/** Time allowed for the clone and for each later git command. */
export interface GitLimits {
  cloneMs: number;
  commandMs: number;
}
const DEFAULT_LIMITS: GitLimits = { cloneMs: CLONE_TIMEOUT_MS, commandMs: GIT_TIMEOUT_MS };

export interface TreeEntry {
  path: string;
  type: "dir" | "file";
}

export type FileRead =
  | { status: "ok"; text: string }
  | { status: "missing" }
  | { status: "unavailable" };

function cloneRoot(): string {
  return join(tmpdir(), "otterdeploy-git-snapshots");
}

function nowMs(): number {
  return Temporal.Now.instant().epochMilliseconds;
}

interface GitRun {
  code: number;
  out: string;
}

/** Run git with no prompts, no terminal and no user config. Null when it could
 *  not be started or ran past `timeoutMs`. */
async function runGit(args: string[], timeoutMs: number): Promise<GitRun | null> {
  const spawned = Result.try(() =>
    Bun.spawn(["git", ...args], {
      stdout: "pipe",
      stderr: "ignore",
      env: {
        // oxlint-disable-next-line node/no-process-env -- inherit host env for the child; per-call additions only (as git-ls-remote.ts).
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "/bin/false",
        // A path from the inspector is a path, never a pathspec expression.
        GIT_LITERAL_PATHSPECS: "1",
      },
    }),
  );
  if (spawned.isErr()) return null;
  const proc = spawned.value;
  const timer = setTimeout(() => proc.kill(9), timeoutMs);
  try {
    const out = await Result.tryPromise(async () => {
      const text = await new Response(proc.stdout).text();
      await proc.exited;
      return text;
    });
    if (out.isErr()) return null;
    return { code: proc.exitCode ?? 1, out: out.value };
  } finally {
    clearTimeout(timer);
  }
}

async function isFresh(dir: string): Promise<boolean> {
  const marker = await Result.tryPromise(() => stat(join(dir, FETCHED_MARKER)));
  return marker.isOk() && nowMs() - marker.value.mtimeMs < CLONE_TTL_MS;
}

/** Remove snapshot directories nothing will read again. Best effort. */
async function sweep(root: string): Promise<void> {
  const names = await Result.tryPromise(() => readdir(root));
  if (names.isErr()) return;
  for (const name of names.value) {
    const dir = join(root, name);
    const info = await Result.tryPromise(() => stat(dir));
    if (info.isOk() && nowMs() - info.value.mtimeMs > SWEEP_AFTER_MS) {
      await Result.tryPromise(() => rm(dir, { recursive: true, force: true }));
    }
  }
}

const inFlight = new Map<string, Promise<string | null>>();

async function cloneInto(
  url: string,
  branch: string,
  dir: string,
  cloneMs: number,
): Promise<string | null> {
  await Result.tryPromise(() => rm(dir, { recursive: true, force: true }));
  const made = await Result.tryPromise(() => mkdir(cloneRoot(), { recursive: true }));
  if (made.isErr()) return null;
  void sweep(cloneRoot());
  const cloned = await runGit(
    [
      "clone",
      "--quiet",
      "--depth=1",
      "--filter=blob:none",
      "--no-checkout",
      "--no-tags",
      "--single-branch",
      `--branch=${branch}`,
      "--",
      url,
      dir,
    ],
    cloneMs,
  );
  if (!cloned || cloned.code !== 0) {
    await Result.tryPromise(() => rm(dir, { recursive: true, force: true }));
    return null;
  }
  const marked = await Result.tryPromise(() => writeFile(join(dir, FETCHED_MARKER), ""));
  return marked.isOk() ? dir : null;
}

/** The directory holding a current shallow clone of `url` at `branch`, cloning
 *  it when there is none. Concurrent callers share one clone. */
async function ensureClone(url: string, branch: string, cloneMs: number): Promise<string | null> {
  if (FULL_SHA.test(branch) || !SAFE_REF.test(branch) || branch.includes("..")) return null;
  const key = createHash("sha256").update(`${url}\0${branch}`).digest("hex").slice(0, 32);
  const dir = join(cloneRoot(), key);
  if (await isFresh(dir)) return dir;
  const running = inFlight.get(key);
  if (running) return running;
  const started = cloneInto(url, branch, dir, cloneMs).finally(() => inFlight.delete(key));
  inFlight.set(key, started);
  return started;
}

/**
 * Every file and directory of the repo at `branch`, or null when git could not
 * read it (private repo, no network, git missing): the caller then asks the API.
 */
export async function gitTreeEntries(
  url: string,
  branch: string,
  limits: GitLimits = DEFAULT_LIMITS,
): Promise<TreeEntry[] | null> {
  const dir = await ensureClone(url, branch, limits.cloneMs);
  if (!dir) return null;
  // `-t` lists the directories too; `-z` keeps odd file names intact.
  const listed = await runGit(["-C", dir, "ls-tree", "-r", "-t", "-z", "HEAD"], limits.commandMs);
  if (!listed || listed.code !== 0) return null;
  const entries: TreeEntry[] = [];
  for (const record of listed.out.split("\0")) {
    // "<mode> <type> <sha>\t<path>"; a submodule's type is "commit" and is
    // skipped, as the API listing's callers skip it.
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const type = record.slice(0, tab).split(" ")[1];
    const path = record.slice(tab + 1);
    if (type === "tree") entries.push({ path, type: "dir" });
    else if (type === "blob") entries.push({ path, type: "file" });
  }
  return entries;
}

/** One file at the tip of `branch`: its text, "missing", or "unavailable". */
export async function gitReadFile(
  url: string,
  branch: string,
  path: string,
  limits: GitLimits = DEFAULT_LIMITS,
): Promise<FileRead> {
  const dir = await ensureClone(url, branch, limits.cloneMs);
  if (!dir) return { status: "unavailable" };
  const found = await runGit(
    ["-C", dir, "ls-tree", "-l", "-z", "HEAD", "--", path],
    limits.commandMs,
  );
  if (!found || found.code !== 0) return { status: "unavailable" };
  // "<mode> <type> <sha> <size>\t<path>"; empty output means no such path.
  const record = found.out.split("\0")[0] ?? "";
  const tab = record.indexOf("\t");
  if (tab < 0) return { status: "missing" };
  const [, type, sha, size] = record.slice(0, tab).split(/\s+/);
  if (type !== "blob" || !sha || !FULL_SHA.test(sha)) return { status: "missing" };
  if (Number.parseInt(size ?? "", 10) > MAX_FILE_BYTES) return { status: "missing" };
  const blob = await runGit(["-C", dir, "cat-file", "blob", sha], limits.commandMs);
  if (!blob || blob.code !== 0) return { status: "unavailable" };
  return { status: "ok", text: blob.out };
}

/** The anonymous clone URL of a public GitHub repo, or null for an owner/repo
 *  that is not a plain GitHub name (nothing odd reaches git's argv). */
export function publicGithubCloneUrl(owner: string, repo: string): string | null {
  const name = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  return name.test(owner) && name.test(repo) ? `https://github.com/${owner}/${repo}.git` : null;
}
