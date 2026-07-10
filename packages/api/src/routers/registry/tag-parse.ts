/**
 * Pure parsing for the registry tag browser — image-ref splitting and the
 * tags/manifest response parsers. No fetch, no db. Split out of
 * list-tags.ts, which keeps the HTTP flow and re-exports these.
 */

export interface ImageRef {
  /** Canonical registry host as stored in container_registry (docker.io, ghcr.io, …). */
  host: string;
  /** Repository path within the registry ("library/nginx", "acme/api"). */
  repository: string;
}

// Repository path segments per the distribution reference grammar
// (lowercase alphanumerics with ._- separators, joined by slashes).
const REPOSITORY_RE =
  /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*$/;

/**
 * Split an image reference into registry host + repository. Accepts the
 * same shapes `docker pull` does: bare names ("nginx"), hub org paths
 * ("acme/api"), fully-qualified refs ("ghcr.io/acme/api"), with an
 * optional :tag or @digest suffix (both are stripped — the browser lists
 * ALL tags of the repository). Returns null for anything malformed.
 */
export function parseImageRef(input: string): ImageRef | null {
  let ref = input.trim();
  if (ref === "") return null;
  // Strip @digest, then :tag (only when the colon is after the last slash —
  // "registry:5000/app" keeps its port).
  const at = ref.indexOf("@");
  if (at !== -1) ref = ref.slice(0, at);
  const lastSlash = ref.lastIndexOf("/");
  const lastColon = ref.lastIndexOf(":");
  if (lastColon > lastSlash) ref = ref.slice(0, lastColon);
  if (ref === "") return null;

  const slashIdx = ref.indexOf("/");
  // Mirrors resolveRegistryAuth's imageRegistry(): a first segment with a
  // dot, colon, or "localhost" is a host; otherwise it's a Docker Hub path.
  let host = "docker.io";
  let repository = ref;
  if (slashIdx !== -1) {
    const first = ref.slice(0, slashIdx);
    if (first.includes(".") || first.includes(":") || first === "localhost") {
      host = first.toLowerCase();
      repository = ref.slice(slashIdx + 1);
    }
  }
  if (host === "docker.io" && !repository.includes("/")) {
    // Bare official images live under the "library" namespace.
    repository = `library/${repository}`;
  }
  repository = repository.toLowerCase();
  if (!REPOSITORY_RE.test(repository)) return null;
  return { host, repository };
}

/**
 * Host to hit for /v2/ API calls. Docker Hub's canonical credential host
 * is "docker.io" but its registry API lives on registry-1.docker.io.
 */
export function registryApiHost(host: string): string {
  return host === "docker.io" ? "registry-1.docker.io" : host;
}

/** Extract the tag names from a /v2/…/tags/list body. Null when malformed. */
export function parseTagsBody(body: unknown): string[] | null {
  if (typeof body !== "object" || body === null) return null;
  const tags = (body as { tags?: unknown }).tags;
  // A repository with zero tags legitimately returns `"tags": null`.
  if (tags === null || tags === undefined) return [];
  if (!Array.isArray(tags)) return null;
  return tags.filter((t): t is string => typeof t === "string");
}

/** RFC-5988 Link header → does the listing have a next page? */
export function hasNextPage(linkHeader: string | null): boolean {
  return linkHeader !== null && /rel="?next"?/.test(linkHeader);
}

/**
 * Compressed image size from a manifest GET body: config + layer sizes for
 * single-arch image manifests. Multi-arch indexes (`manifests` array) and
 * anything malformed return undefined — no fabricated numbers.
 */
export function imageSizeFromManifest(body: unknown): number | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const m = body as { config?: { size?: unknown }; layers?: Array<{ size?: unknown }> };
  if (!Array.isArray(m.layers)) return undefined;
  let total = typeof m.config?.size === "number" ? m.config.size : 0;
  for (const layer of m.layers) {
    if (typeof layer?.size !== "number") return undefined;
    total += layer.size;
  }
  return total;
}
