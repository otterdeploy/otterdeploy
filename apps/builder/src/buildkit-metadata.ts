/**
 * Recover a pushed image's content digest from buildx's `--metadata-file`
 * JSON, instead of a local `docker inspect`.
 *
 * When a build goes straight to a registry via `--push` through the remote
 * buildkitd (see `buildx.ts`, `dockerfile.ts`, `railpack.ts`), the result
 * never lands in the local docker daemon — there is no local image to
 * `docker inspect ... RepoDigests` (the mechanism `docker-push.ts` uses for
 * the `--load`-based fallback path). `--metadata-file` is BuildKit's own
 * side-channel for exactly this: it writes a JSON blob containing
 * `containerimage.digest` next to the build, with no docker daemon involved
 * at all.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Allocate a scratch path for `--metadata-file` output. One throwaway temp
 *  dir per build so concurrent builds (unlikely today — the worker builds in
 *  series — but true for any future parallelism) never collide. */
export async function tmpMetadataFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "otter-buildkit-meta-"));
  return join(dir, "metadata.json");
}

/**
 * Read `containerimage.digest` out of a buildx `--metadata-file`. Best
 * effort: any read/parse failure (file never written — e.g. the build itself
 * failed before producing one) returns null rather than throwing. The digest
 * is metadata; a missing one must never fail an otherwise-successful push.
 */
export async function readImageDigest(metadataFile: string): Promise<string | null> {
  try {
    const raw = await readFile(metadataFile, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const digest = (parsed as Record<string, unknown>)["containerimage.digest"];
    return typeof digest === "string" ? digest : null;
  } catch {
    return null;
  }
}

/** Best-effort cleanup of the scratch dir `tmpMetadataFile` allocated. */
export async function cleanupMetadataFile(metadataFile: string): Promise<void> {
  await rm(join(metadataFile, ".."), { recursive: true, force: true }).catch(() => undefined);
}
