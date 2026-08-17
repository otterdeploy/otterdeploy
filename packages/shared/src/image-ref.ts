/**
 * Container image reference helpers, parsing and display shortening for
 * `[registry/]repo[:tag][@sha256:…]` strings and the digests registries hand
 * back. Pure string work, no platform deps: the API layer, the builder, the
 * CLI and the web app all speak this vocabulary and must shorten it the same
 * way, or the same image reads as two different things across screens.
 */

/** Conventional short-digest lengths: 7 for a caption beside a tag, 12 for
 *  the Docker CLI's image/container id column. */
export const DIGEST_SHORT = 7;
export const DIGEST_ID = 12;

/**
 * Strip the `sha256:` algorithm prefix and truncate to `length` hex chars.
 * Returns `null` for a missing or empty digest so callers can render
 * "the digest or nothing" without inventing a placeholder.
 *
 *   shortDigest("sha256:9f2b0c…")     // "9f2b0c8"
 *   shortDigest("sha256:9f2b0c…", 12) // "9f2b0c8d1e4a"
 *   shortDigest(undefined)            // null
 */
export function shortDigest(
  digest: string | null | undefined,
  length: number = DIGEST_SHORT,
): string | null {
  if (!digest) return null;
  const hex = digest.replace(/^[a-z0-9]+:/, "").slice(0, length);
  return hex || null;
}

/**
 * Split an image ref into repo + tag on the final colon. A colon that belongs
 * to a registry port (`localhost:5000/app`) is followed by a path segment, so
 * a "tag" containing `/` means there was no tag at all.
 *
 *   splitRef("ghcr.io/owner/app:1.2") // { repo: "ghcr.io/owner/app", tag: "1.2" }
 *   splitRef("localhost:5000/app")    // { repo: "localhost:5000/app", tag: "" }
 */
export function splitRef(ref: string): { repo: string; tag: string } {
  const i = ref.lastIndexOf(":");
  if (i === -1) return { repo: ref, tag: "" };
  const tag = ref.slice(i + 1);
  if (tag.includes("/")) return { repo: ref, tag: "" };
  return { repo: ref.slice(0, i), tag };
}
