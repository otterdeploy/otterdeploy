/**
 * Resolve a branch or tag of a public repo with `git ls-remote`: the fallback
 * for {@link fetchBranchHead} when GitHub's REST API refuses an ANONYMOUS
 * caller. That API allows 60 requests an hour per IP, and every public-repo
 * deploy spends several of them (repo inspection, framework detection, the
 * head lookup), so a handful of deploys in an hour made the next one fail with
 * "GitHub commit lookup failed (403)" (`core.remaining 0`). The git protocol
 * has no such budget, and the builder clones over it anyway.
 *
 * Only the SHA comes back: the commit message and author need the API, so a
 * deployment resolved this way shows no provenance, which degrades the card,
 * never the build.
 */
import { Result } from "better-result";

const FULL_SHA = /^[0-9a-f]{40}$/;
/** A ref name git would never read as an option or a pattern (check-ref-format's
 *  forbidden characters, plus a leading `-`). Tags like `@scope/pkg@1.2.3` pass. */
const SAFE_REF = /^[^-\s~^:?*[\\][^\s~^:?*[\\]*$/;
const LS_REMOTE_TIMEOUT_MS = 20_000;

/**
 * The commit `ref` names in `git ls-remote` output: the branch, else the tag
 * (an annotated tag's peeled `^{}` line is the commit; the bare line is the tag
 * object). Null when the output names neither.
 */
export function shaFromLsRemote(output: string, ref: string): string | null {
  const rows = new Map<string, string>();
  for (const line of output.split("\n")) {
    const [sha, name] = line.trim().split(/\s+/);
    if (sha && name && FULL_SHA.test(sha)) rows.set(name, sha);
  }
  return (
    rows.get(`refs/heads/${ref}`) ??
    rows.get(`refs/tags/${ref}^{}`) ??
    rows.get(`refs/tags/${ref}`) ??
    null
  );
}

/**
 * The commit `ref` (branch, tag, or a full SHA, which is its own answer) names
 * in the repo at `url`, read anonymously. Null on any failure: a private repo,
 * an unknown ref, no network, or git missing. Never prompts for credentials.
 */
export async function lsRemoteSha(
  url: string,
  ref: string,
  timeoutMs = LS_REMOTE_TIMEOUT_MS,
): Promise<string | null> {
  if (FULL_SHA.test(ref)) return ref;
  if (!SAFE_REF.test(ref) || ref.includes("..") || ref.includes("@{")) return null;
  const spawned = Result.try(() =>
    // `ref^{}` too: over protocol v2 ls-remote omits an annotated tag's
    // peeled line unless it is asked for by name.
    Bun.spawn(["git", "ls-remote", "--", url, ref, `${ref}^{}`], {
      stdout: "pipe",
      stderr: "ignore",
      // oxlint-disable-next-line node/no-process-env -- inherit host env for the child; per-call additions only (as rustic-spawn.ts).
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/bin/false" },
    }),
  );
  if (spawned.isErr()) return null;
  const proc = spawned.value;
  // A remote that accepts and never answers must not hold the deploy request.
  const timer = setTimeout(() => proc.kill(9), timeoutMs);
  try {
    const output = await Result.tryPromise(async () => {
      const text = await new Response(proc.stdout).text();
      await proc.exited;
      return text;
    });
    if (output.isErr() || proc.exitCode !== 0) return null;
    return shaFromLsRemote(output.value, ref);
  } finally {
    clearTimeout(timer);
  }
}
