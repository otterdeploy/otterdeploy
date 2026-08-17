/**
 * get.otterdeploy.com. The install edge.
 *
 * Serves the three files a fresh host needs (`install.sh`, `uninstall.sh`,
 * `docker-compose.yml`) plus the `versions.json` manifest that running
 * instances poll for updates. There is no origin server: artifacts live in R2,
 * written only by the `publish-artifacts` job in .github/workflows/images.yml.
 *
 * Why this exists rather than pointing people at raw.githubusercontent.com:
 *   1. A stable, brandable URL that survives repo renames and file moves.
 *   2. Install counts. GHCR publishes no pull stats and raw.githubusercontent
 *      gives us nothing, so today we have zero visibility into adoption. Every
 *      request through here is a datapoint (see `record`). The same mechanism
 *      Coolify uses, which is how they can quote an active-instance number.
 *
 * Two paths per artifact:
 *   /install.sh              newest STABLE release ("latest/" in R2)
 *   /v0.4.2/install.sh       that exact release, immutable forever
 *
 * Pinned paths matter because the installer resolves a version and then pulls
 * a compose file; without them an install of v0.4.2 would get whatever compose
 * `latest` happened to be, which is how you get a compose/image skew bug that
 * only reproduces on old installs.
 */

interface Env {
  ARTIFACTS: R2Bucket;
  ANALYTICS?: AnalyticsEngineDataset;
  FALLBACK_REPO: string;
  DOCS_URL: string;
}

/**
 * What this edge serves, and where each file lives in the repo. `repoPath` is
 * the fallback source when R2 has no object yet (see `fallback`).
 *
 * Note `docker-compose.yml` maps to `docker-compose.prod.yml`. The repo's own
 * `docker-compose.yml` builds from source and references a locally-built dev
 * image (the `x-builder-image` anchor, never published to a registry); serving
 * it to a fresh host fails on pull.
 * The published name is deliberately the plain one so the installer's default
 * `docker compose -f docker-compose.yml` works with no flag.
 */
const ARTIFACTS = {
  "install.sh": {
    repoPath: "scripts/install.sh",
    contentType: "text/x-shellscript; charset=utf-8",
  },
  "uninstall.sh": {
    repoPath: "scripts/uninstall.sh",
    contentType: "text/x-shellscript; charset=utf-8",
  },
  "docker-compose.yml": {
    repoPath: "docker-compose.prod.yml",
    contentType: "text/yaml; charset=utf-8",
  },
} as const;

type ArtifactName = keyof typeof ARTIFACTS;

/** Release tags only: `v1.2.3`, optionally `-rc.1`. Anything else 404s rather
 *  than reaching R2, so a stray path can't be used to probe the bucket. */
const VERSION_RE = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;

const MANIFEST_KEY = "versions.json";

/** A pinned version can never change, so cache it forever. `latest` moves on
 *  every release: five minutes bounds how long a new release stays invisible. */
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const LATEST_CACHE = "public, max-age=300";
/** The update-poll target. Short, so "update available" lights up promptly. */
const MANIFEST_CACHE = "public, max-age=60";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return text("Method not allowed\n", 405, { Allow: "GET, HEAD" });
    }

    const url = new URL(request.url);
    const route = parse(url.pathname);

    if (route.kind === "root") {
      return Response.redirect(env.DOCS_URL, 302);
    }
    if (route.kind === "unknown") {
      return text("Not found\n", 404);
    }

    // Counted before the cache lookup: the Worker runs on every request, so
    // an edge HIT is still an install we know about.
    ctx.waitUntil(record(request, env, route));

    const cache = caches.default;
    const hit = await cache.match(request);
    if (hit) return hit;

    const response =
      route.kind === "manifest"
        ? await manifest(env)
        : await artifact(env, route.version, route.name, route.checksum);

    if (response.ok && request.method === "GET") {
      ctx.waitUntil(cache.put(request, response.clone()));
    }
    return response;
  },
} satisfies ExportedHandler<Env>;

// ── routing ─────────────────────────────────────────────────────────────────

type Route =
  | { kind: "root" }
  | { kind: "unknown" }
  | { kind: "manifest" }
  | { kind: "artifact"; version: string | null; name: ArtifactName; checksum: boolean };

/**
 * `/[<version>/]<artifact>[.sha256]`, or `/versions.json`.
 * `version === null` means the `latest` channel.
 */
function parse(pathname: string): Route {
  if (pathname === "/" || pathname === "") return { kind: "root" };
  if (pathname === `/${MANIFEST_KEY}`) return { kind: "manifest" };

  const segments = pathname.replace(/^\/+/, "").split("/");
  if (segments.length > 2) return { kind: "unknown" };

  let version: string | null = null;
  if (segments.length === 2) {
    const candidate = segments[0] ?? "";
    if (!VERSION_RE.test(candidate)) return { kind: "unknown" };
    version = candidate;
  }

  let file = segments[segments.length - 1] ?? "";
  const checksum = file.endsWith(".sha256");
  if (checksum) file = file.slice(0, -".sha256".length);

  if (!isArtifactName(file)) return { kind: "unknown" };
  return { kind: "artifact", version, name: file, checksum };
}

function isArtifactName(file: string): file is ArtifactName {
  return file in ARTIFACTS;
}

// ── serving ─────────────────────────────────────────────────────────────────

async function artifact(
  env: Env,
  version: string | null,
  name: ArtifactName,
  checksum: boolean,
): Promise<Response> {
  const prefix = version ?? "latest";
  const key = `${prefix}/${name}${checksum ? ".sha256" : ""}`;

  const object = await env.ARTIFACTS.get(key);
  if (object) {
    return new Response(object.body, {
      headers: headers({
        "Content-Type": checksum ? "text/plain; charset=utf-8" : ARTIFACTS[name].contentType,
        "Cache-Control": version ? IMMUTABLE_CACHE : LATEST_CACHE,
        ETag: object.httpEtag,
        "X-Otterdeploy-Version": version ?? "latest",
      }),
    });
  }

  // A checksum can't be synthesised from a fallback. Serving the file from
  // GitHub while claiming an R2 digest would be worse than a clean 404.
  if (checksum) return text("Not found\n", 404);

  return fallback(env, version, name);
}

/**
 * R2 miss → serve from the repo over GitHub raw. Keeps the documented install
 * URL working before the first release is published (release-day bootstrap)
 * and during any window where a tag exists but the upload hasn't landed.
 */
async function fallback(env: Env, version: string | null, name: ArtifactName): Promise<Response> {
  const ref = version ?? "main";
  const source = `https://raw.githubusercontent.com/${env.FALLBACK_REPO}/${ref}/${ARTIFACTS[name].repoPath}`;

  const upstream = await fetch(source, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!upstream.ok) return text("Not found\n", 404);

  return new Response(upstream.body, {
    headers: headers({
      "Content-Type": ARTIFACTS[name].contentType,
      // Never immutable: this is the un-pinned repo state, not a release
      // artifact, so it must not be cached like one.
      "Cache-Control": LATEST_CACHE,
      "X-Otterdeploy-Version": version ?? "main",
      "X-Otterdeploy-Source": "fallback",
    }),
  });
}

/**
 * The update-poll target. Shaped to match GitHub's `releases/latest` payload
 * (`tag_name` / `html_url` / `body`) so the control plane's existing updater
 * consumes it with no code change. An operator just sets
 * `OTTERDEPLOY_UPDATE_MANIFEST_URL` to this URL. See
 * packages/api/src/routers/system/release-source.ts.
 */
async function manifest(env: Env): Promise<Response> {
  const object = await env.ARTIFACTS.get(MANIFEST_KEY);
  if (object) {
    return new Response(object.body, {
      headers: headers({
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": MANIFEST_CACHE,
        ETag: object.httpEtag,
      }),
    });
  }

  // Same bootstrap reasoning as `fallback`: proxy the API this manifest is
  // modelled on, so polling instances get a real answer from day zero.
  const upstream = await fetch(
    `https://api.github.com/repos/${env.FALLBACK_REPO}/releases/latest`,
    {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "otterdeploy-get" },
      cf: { cacheTtl: 60, cacheEverything: true },
    },
  );
  if (!upstream.ok) return text("{}\n", 200, { "Content-Type": "application/json; charset=utf-8" });

  return new Response(upstream.body, {
    headers: headers({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": MANIFEST_CACHE,
      "X-Otterdeploy-Source": "fallback",
    }),
  });
}

// ── counting ────────────────────────────────────────────────────────────────

/**
 * One datapoint per request. Two questions this answers:
 *
 *   installs: count where blob1 = 'install.sh'
 *   active: count DISTINCT index1 where blob1 = 'versions.json', last 24h
 *
 * `index1` is a truncated SHA-256 of the client IP. It is never stored or
 * logged in the clear and can't be reversed to an address, but it is stable
 * enough within a window to deduplicate one host polling every few minutes,
 * which is the whole "how many people are running this" number.
 */
async function record(request: Request, env: Env, route: Route): Promise<void> {
  if (!env.ANALYTICS) return;
  if (route.kind !== "artifact" && route.kind !== "manifest") return;

  const file = route.kind === "manifest" ? MANIFEST_KEY : route.name;
  const version = route.kind === "manifest" ? "" : (route.version ?? "latest");

  env.ANALYTICS.writeDataPoint({
    blobs: [
      file,
      version,
      // Header rather than `request.cf.country`: the latter is typed loosely
      // enough that it stringifies to "[object Object]" in some shapes.
      request.headers.get("CF-IPCountry") ?? "",
      request.headers.get("User-Agent")?.slice(0, 128) ?? "",
    ],
    doubles: [1],
    indexes: [await clientHash(request)],
  });
}

async function clientHash(request: Request): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** `nosniff` on everything: these responses get piped straight into `bash`,
 *  so a content-type the browser second-guesses is not a risk worth taking. */
function headers(extra: Record<string, string>): Record<string, string> {
  return { "X-Content-Type-Options": "nosniff", ...extra };
}

function text(body: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: headers({ "Content-Type": "text/plain; charset=utf-8", ...extra }),
  });
}
