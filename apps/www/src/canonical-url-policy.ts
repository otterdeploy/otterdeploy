/** Only the two configured production routes are canonicalised. Portless,
 * local development, branch domains and workers.dev previews stay on their
 * own host; preview response policy separately keeps them out of the index. */
function isCanonicalisable(hostname: string): boolean {
  return hostname === "otterdeploy.com" || hostname === "www.otterdeploy.com";
}

/** Resolve only an exact production hostname, optionally with one DNS root
 * dot. Lookalikes and hosts with multiple terminal dots remain previews. */
function productionHostnameFor(hostname: string): string | null {
  if (isCanonicalisable(hostname)) return hostname;

  const withoutRootDot = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  return isCanonicalisable(withoutRootDot) ? withoutRootDot : null;
}

function requestProtocol(request: Request): string {
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  return (
    forwardedProtocol?.split(",", 1)[0]?.trim().toLowerCase() ??
    new URL(request.url).protocol.replace(/:$/, "")
  );
}

interface NormalisedProductionUrl {
  changed: boolean;
  url: URL;
}

/** Normalise the production origin details shared by pages and server functions. */
function normalisedProductionUrlFor(request: Request): NormalisedProductionUrl | null {
  const url = new URL(request.url);
  const productionHostname = productionHostnameFor(url.hostname);
  if (productionHostname === null) return null;

  let changed = false;

  if (url.hostname !== productionHostname) {
    url.hostname = productionHostname;
    changed = true;
  }

  // Behind Cloudflare the Worker can see the original scheme on the URL, but
  // `x-forwarded-proto` is the header that survives every proxy in front of
  // us, so trust it when present.
  if (requestProtocol(request) === "http" || url.protocol !== "https:") {
    url.protocol = "https:";
    changed = true;
  }

  if (url.port !== "") {
    url.port = "";
    changed = true;
  }

  return { changed, url };
}

/** Upgrade an RPC request without rewriting its opaque path or host. */
function serverFunctionHttpsUrlFor(request: Request): URL | null {
  const normalised = normalisedProductionUrlFor(request);
  return normalised?.changed ? normalised.url : null;
}

/**
 * The canonical URL for a request, or `null` when it is already canonical.
 * Kept independent of the framework so every redirect branch is unit-testable.
 */
export function canonicalUrlFor(request: Request, pathname: string): URL | null {
  const normalised = normalisedProductionUrlFor(request);
  if (normalised === null) return null;

  const { url } = normalised;
  let { changed } = normalised;

  if (url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.slice(4);
    changed = true;
  }

  // Every authored route and generated OpenAPI slug is lower-case. Normalise
  // repeated slashes here too: otherwise TanStack adds another redirect after
  // scheme and host have already been fixed.
  const normalisedPathname = pathname.toLowerCase().replace(/\/{2,}/g, "/");

  // The old landing route now lives at `/`. Fold its redirect into this pass
  // on production hosts so all variants resolve in one hop. Local and
  // workers.dev requests still reach the route-level redirect, because those
  // hosts returned above.
  if (normalisedPathname.replace(/\/+$/, "") === "/next") {
    url.pathname = "/";
    changed = true;
  } else {
    // `/` is legitimately a single slash; collapsing it would loop. Any other
    // run of trailing slashes goes, in one step rather than one per slash.
    const canonicalPathname =
      normalisedPathname === "/" ? "/" : normalisedPathname.replace(/\/+$/, "") || "/";
    // TanStack may decode RFC-unreserved escapes before passing `pathname`
    // (for example, `/%64ocs` arrives as `/docs`). Compare with the request
    // URL's still-encoded path so those aliases also receive a canonical 301.
    if (canonicalPathname !== url.pathname) {
      url.pathname = canonicalPathname;
      changed = true;
    }
  }

  // `url` still carries the original search and hash, so `?q=` survives —
  // dropping it silently loses a search, which is a bug nobody reports.
  return changed ? url : null;
}

interface CanonicalRedirect {
  url: URL;
  status: 301 | 308;
}

/**
 * Resolve the exact redirect the middleware will emit. GET and HEAD page
 * aliases use 301; every method-bearing request uses 308 so its body and
 * method survive. Server functions only receive the HTTPS upgrade because
 * lower-casing or re-hosting an opaque RPC endpoint can break the call.
 */
export function canonicalRedirectFor(
  request: Request,
  pathname: string,
  handlerType: string,
): CanonicalRedirect | null {
  const url =
    handlerType === "serverFn"
      ? serverFunctionHttpsUrlFor(request)
      : canonicalUrlFor(request, pathname);
  if (url === null) return null;

  const safeToRewriteMethod = request.method === "GET" || request.method === "HEAD";
  return { url, status: handlerType === "serverFn" || !safeToRewriteMethod ? 308 : 301 };
}
