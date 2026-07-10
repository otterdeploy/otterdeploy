/**
 * Docker Registry HTTP API v2 tag listing for the create-wizard's tag
 * browser.
 *
 * Flow (per https://distribution.github.io/distribution/spec/api/):
 *
 *   1. GET https://<apiHost>/v2/<repository>/tags/list?n=<limit>
 *      200 → done (no auth registry).
 *      401 → follow the WWW-Authenticate challenge exactly like the
 *      testConnection probe, but with a `repository:<name>:pull` scope.
 *      Anonymous token exchange works for public images (Docker Hub,
 *      public GHCR); stored credentials ride along as basic auth for
 *      private repositories.
 *   2. For the first few tags, GET the manifest to enrich with the
 *      content digest (Docker-Content-Digest header) and — when the
 *      response is a single-arch image manifest — the compressed image
 *      size (config + layer sizes). Multi-arch indexes only expose
 *      per-platform sizes behind another round-trip, so size is
 *      honestly omitted for them rather than guessed.
 *
 * No db imports — pure fetch + parsing so the module stays unit
 * testable. Credential lookup lives in queries.ts; index.ts glues.
 */

import { Result, TaggedError } from "better-result";

import { parseAuthChallenge, buildTokenUrl } from "./test-connection";

/** Max tags returned per call — the wizard browser is a picker, not a mirror. */
export const TAG_PAGE_LIMIT = 50;
/** How many tags get the extra manifest round-trip for digest/size. */
export const TAG_META_LIMIT = 12;

const FETCH_TIMEOUT_MS = 10_000;

const MANIFEST_ACCEPT = [
  "application/vnd.docker.distribution.manifest.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.index.v1+json",
].join(", ");

export class RegistryTagsError extends TaggedError("RegistryTagsError")<{
  message: string;
  status: number | undefined;
}>() {}

export interface ImageRef {
  /** Canonical registry host as stored in container_registry (docker.io, ghcr.io, …). */
  host: string;
  /** Repository path within the registry ("library/nginx", "acme/api"). */
  repository: string;
}

export interface TagInfo {
  name: string;
  /** Content digest (`sha256:…`) when the manifest lookup succeeded. */
  digest?: string;
  /** Compressed image size (config + layers) for single-arch manifests. */
  sizeBytes?: number;
}

export interface TagListing {
  tags: TagInfo[];
  /** True when the registry has more tags than the page limit. */
  truncated: boolean;
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

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

async function timedFetch(
  host: string,
  url: string,
  headers?: Record<string, string>,
): Promise<Result<Response, RegistryTagsError>> {
  try {
    const res = await fetch(url, {
      ...(headers && { headers }),
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return Result.ok(res);
  } catch (err) {
    const message =
      err instanceof DOMException && err.name === "TimeoutError"
        ? `Timed out after ${FETCH_TIMEOUT_MS / 1000}s waiting for ${host}`
        : `Could not reach ${host}: ${err instanceof Error ? err.message : "network error"}`;
    return Result.err(new RegistryTagsError({ status: undefined, message }));
  }
}

/** Honest message for a failed tags/token response. */
function statusError(input: {
  host: string;
  repository: string;
  status: number;
  hasCredentials: boolean;
}): RegistryTagsError {
  const { host, repository, status, hasCredentials } = input;
  if (status === 401 || status === 403) {
    return new RegistryTagsError({
      status,
      message: hasCredentials
        ? `${host} rejected the credentials for ${repository} (${status}) — check the registry credential's access to this repository`
        : `${repository} on ${host} requires authentication — add a registry credential to browse private repositories`,
    });
  }
  if (status === 404) {
    return new RegistryTagsError({
      status,
      message: `${repository} was not found on ${host} — check the image name (private repositories can also read as 404)`,
    });
  }
  if (status === 429) {
    return new RegistryTagsError({
      status,
      message: `${host} rate-limited the request (429) — try again in a bit, or add a registry credential to raise the limit`,
    });
  }
  return new RegistryTagsError({
    status,
    message: `${host} responded ${status} to the tag listing`,
  });
}

/**
 * Follow a 401's WWW-Authenticate challenge and return the Authorization
 * header value for retrying — bearer token exchange (anonymous when no
 * credentials) or plain basic auth.
 */
async function authorize(input: {
  host: string;
  repository: string;
  wwwAuthenticate: string | null;
  username: string;
  password: string;
}): Promise<Result<string, RegistryTagsError>> {
  const { host, repository, username, password } = input;
  const hasCredentials = username.length > 0 && password.length > 0;
  const challenge = parseAuthChallenge(input.wwwAuthenticate);
  if (!challenge) {
    return Result.err(
      new RegistryTagsError({
        status: 401,
        message: `${host} returned 401 without an auth challenge this client can follow`,
      }),
    );
  }

  if (challenge.scheme === "basic") {
    if (!hasCredentials) {
      return Result.err(statusError({ host, repository, status: 401, hasCredentials }));
    }
    return Result.ok(basicAuthHeader(username, password));
  }

  let tokenUrl: string;
  try {
    tokenUrl = buildTokenUrl({
      ...challenge,
      // The bare challenge may carry no scope — ask for pull on this repo.
      scope: challenge.scope ?? `repository:${repository}:pull`,
    });
  } catch {
    return Result.err(
      new RegistryTagsError({
        status: 401,
        message: `${host} sent a malformed auth challenge (realm "${challenge.realm}" is not a URL)`,
      }),
    );
  }

  const tokenRes = await timedFetch(
    host,
    tokenUrl,
    hasCredentials ? { authorization: basicAuthHeader(username, password) } : undefined,
  );
  if (tokenRes.isErr()) return Result.err(tokenRes.error);
  if (!tokenRes.value.ok) {
    return Result.err(
      statusError({ host, repository, status: tokenRes.value.status, hasCredentials }),
    );
  }
  const body = (await tokenRes.value.json().catch(() => null)) as {
    token?: string;
    access_token?: string;
  } | null;
  const token = body?.token ?? body?.access_token;
  if (!token) {
    return Result.err(
      new RegistryTagsError({
        status: tokenRes.value.status,
        message: `${host}'s token endpoint answered 200 but returned no token`,
      }),
    );
  }
  return Result.ok(`Bearer ${token}`);
}

/** Enrich up to TAG_META_LIMIT tags with digest/size via manifest GETs.
 *  Best-effort: a failed lookup leaves the tag bare rather than failing
 *  the whole listing. */
async function enrichTags(input: {
  apiHost: string;
  repository: string;
  names: string[];
  authorization: string | undefined;
}): Promise<TagInfo[]> {
  const { apiHost, repository, names, authorization } = input;
  return Promise.all(
    names.map(async (name, i): Promise<TagInfo> => {
      if (i >= TAG_META_LIMIT) return { name };
      const res = await timedFetch(
        apiHost,
        `https://${apiHost}/v2/${repository}/manifests/${encodeURIComponent(name)}`,
        {
          accept: MANIFEST_ACCEPT,
          ...(authorization && { authorization }),
        },
      );
      if (res.isErr() || !res.value.ok) return { name };
      const digest = res.value.headers.get("docker-content-digest") ?? undefined;
      const body: unknown = await res.value.json().catch(() => null);
      const sizeBytes = imageSizeFromManifest(body);
      return {
        name,
        ...(digest !== undefined && { digest }),
        ...(sizeBytes !== undefined && { sizeBytes }),
      };
    }),
  );
}

/**
 * List a repository's tags. `username`/`password` empty → anonymous
 * (public images). Failures come back as typed errors with operator-
 * readable messages — rate limits, private repos, and unreachable hosts
 * each say what actually happened.
 */
export async function fetchRegistryTags(input: {
  host: string;
  repository: string;
  username: string;
  password: string;
}): Promise<Result<TagListing, RegistryTagsError>> {
  const { host, repository, username, password } = input;
  const hasCredentials = username.length > 0 && password.length > 0;
  const apiHost = registryApiHost(host);
  const tagsUrl = `https://${apiHost}/v2/${repository}/tags/list?n=${TAG_PAGE_LIMIT}`;

  let res = await timedFetch(apiHost, tagsUrl);
  if (res.isErr()) return Result.err(res.error);

  let authorization: string | undefined;
  if (res.value.status === 401) {
    const auth = await authorize({
      host: apiHost,
      repository,
      wwwAuthenticate: res.value.headers.get("www-authenticate"),
      username,
      password,
    });
    if (auth.isErr()) return Result.err(auth.error);
    authorization = auth.value;
    res = await timedFetch(apiHost, tagsUrl, { authorization });
    if (res.isErr()) return Result.err(res.error);
  }

  if (!res.value.ok) {
    return Result.err(
      statusError({ host: apiHost, repository, status: res.value.status, hasCredentials }),
    );
  }

  const body: unknown = await res.value.json().catch(() => null);
  const names = parseTagsBody(body);
  if (names === null) {
    return Result.err(
      new RegistryTagsError({
        status: res.value.status,
        message: `${apiHost} answered the tag listing with an unexpected body`,
      }),
    );
  }

  const truncated = hasNextPage(res.value.headers.get("link")) || names.length > TAG_PAGE_LIMIT;
  const page = names.slice(0, TAG_PAGE_LIMIT);
  const tags = await enrichTags({ apiHost, repository, names: page, authorization });
  return Result.ok({ tags, truncated });
}
