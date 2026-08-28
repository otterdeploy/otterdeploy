/**
 * One 301 to the canonical URL: https, apex, no trailing slash.
 *
 * Three separate defects, all the same shape, and all previously answered
 * wrongly or not at all:
 *
 *   - `http://otterdeploy.com` returned **200**. The site was reachable over
 *     plain HTTP, which is both an SEO duplicate and a downgrade a visitor
 *     never asked for.
 *   - `https://www.otterdeploy.com` returned **200**. The canonical tag points
 *     at the apex, so search engines mostly cope, but "mostly cope" is not the
 *     same as one address — and wrangler.jsonc has carried a note about this
 *     301 being pending since the site launched.
 *   - `/docs/` returned **307**. A temporary redirect tells a crawler both
 *     spellings are live, so neither consolidates.
 *
 * Fixed HERE rather than in Cloudflare deliberately. The zone toggles (Always
 * Use HTTPS, a www→apex redirect rule) do the same job one layer earlier and
 * marginally cheaper, but they live in a dashboard: invisible in review,
 * unversioned, and silently lost if the zone is ever recreated — which this
 * project has already done once, moving accounts. This is the same rule, in
 * the repo, deployed with the code that depends on it.
 *
 * ONE redirect, not three. Normalising scheme, host and path in a single pass
 * means `http://www.otterdeploy.com/docs/` reaches its destination in one hop
 * instead of chaining through three, each of which bleeds a little authority
 * and adds a round trip.
 */
import { createMiddleware } from "@tanstack/react-start";

/** Hosts that must never be rewritten: local dev, preview builds, and the
 *  workers.dev fallback. Redirecting `localhost` to https breaks `vite dev`,
 *  and rewriting a preview host would send reviewers to production. */
function isCanonicalisable(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") return false;
  if (hostname.endsWith(".workers.dev")) return false;
  return true;
}

/**
 * The canonical URL for a request, or `null` when it is already canonical.
 *
 * Pure and exported so it can be TESTED. The obvious way to check this — curl
 * the built Worker with a spoofed `Host` — does not work: `wrangler dev`
 * rewrites Host to the first route in wrangler.jsonc, so a request sent as
 * `www.otterdeploy.com` arrives as `otterdeploy.com` and the www branch is
 * never exercised. That produced a convincing false negative. A unit test over
 * this function is the only honest verification.
 */
export function canonicalUrlFor(request: Request, pathname: string): URL | null {
  const url = new URL(request.url);
  if (!isCanonicalisable(url.hostname)) return null;

  let changed = false;

  // Behind Cloudflare the Worker can see the original scheme on the URL, but
  // `x-forwarded-proto` is the header that survives every proxy in front of
  // us, so trust it when present.
  const proto = request.headers.get("x-forwarded-proto");
  if (proto === "http" || (proto === null && url.protocol === "http:")) {
    url.protocol = "https:";
    changed = true;
  }

  if (url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.slice(4);
    changed = true;
  }

  // `/` is legitimately a single slash; collapsing it would loop. Any other
  // run of trailing slashes goes, in one step rather than one per slash.
  if (pathname !== "/" && pathname.endsWith("/")) {
    url.pathname = pathname.replace(/\/+$/, "") || "/";
    changed = true;
  }

  // `url` still carries the original search and hash, so `?q=` survives —
  // dropping it silently loses a search, which is a bug nobody reports.
  return changed ? url : null;
}

export const canonicalUrlMiddleware = createMiddleware({ type: "request" }).server(
  ({ request, pathname, handlerType, next }) => {
    // Server functions are RPC, not pages. Nothing crawls them, and a redirect
    // mid-call breaks the caller.
    if (handlerType === "serverFn") return next();
    const canonical = canonicalUrlFor(request, pathname);
    return canonical === null ? next() : Response.redirect(canonical, 301);
  },
);
