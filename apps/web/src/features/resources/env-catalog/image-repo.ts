/**
 * Image ref → catalog repo key.
 *
 * Its own module because `./index.ts` imports the template schema registry,
 * which uses `?raw` imports that only a bundler can resolve. Tooling that
 * runs under plain bun (`scripts/check-env-schema.ts`) needs this reduction
 * without dragging that graph in — and having two copies of it is how the
 * checker and the product drift about what counts as the same image.
 */

/**
 * Drop digest and tag, lowercase, and strip the implicit `docker.io/` +
 * `library/` prefixes so `postgres:17-alpine`, `library/postgres` and
 * `docker.io/library/postgres@…` all resolve to `postgres`.
 */
export function normalizeImageRepo(image: string): string {
  const noDigest = image.split("@")[0] ?? image;
  const slash = noDigest.lastIndexOf("/");
  const colon = noDigest.lastIndexOf(":");
  const repo = colon > slash ? noDigest.slice(0, colon) : noDigest;
  return repo
    .toLowerCase()
    .replace(/^docker\.io\//, "")
    .replace(/^library\//, "");
}
