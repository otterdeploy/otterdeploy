export const appName = "otterdeploy";
export const docsRoute = "/docs";

/**
 * The one canonical production origin, with no trailing slash.
 *
 * This must be immutable. A preview deployment is a copy of the production
 * site's content, not a new canonical site. Letting a build-time environment
 * variable replace this origin made that preview pass `isCanonicalHost()` and
 * publish its own canonical URLs, sitemap and permissive robots policy. Keep
 * request-host decisions separate from URL generation instead: previews use
 * production canonicals and receive an HTTP noindex policy.
 */
export const siteUrl = "https://otterdeploy.com";

/** Absolute URL for a site-relative path. Crawlers and og: tags need absolute. */
export const absoluteUrl = (path: string) =>
  `${siteUrl}${path.startsWith("/") ? path : `/${path}`}`;

/** Plain-text discovery documents are for crawlers to consume, not for search
 * result pages to rank beside the canonical HTML documentation. */
export const machineReadableTextHeaders = {
  "cache-control": "public, max-age=0, s-maxage=3600",
  "content-type": "text/plain; charset=utf-8",
  "x-robots-tag": "noindex, follow",
} as const;

/**
 * Is this request for the production site, as opposed to a preview
 * (`*.workers.dev`), a branch deployment, or local dev?
 *
 * Decided from the request's own host so it needs no build-time input. See
 * the robots.txt route, whose previous env-var gate silently answered "yes"
 * everywhere. `www.` counts: it's a `custom_domain` route in wrangler.jsonc
 * and serves the same site.
 *
 * An unparseable URL answers `false`. The only caller uses this to decide
 * whether to ALLOW indexing, so the safe answer under uncertainty is the
 * restrictive one: a preview that slips into the index costs more than a
 * production page that briefly doesn't.
 */
export function isCanonicalHost(requestUrl: string): boolean {
  try {
    const { hostname } = new URL(requestUrl);
    const canonical = new URL(siteUrl).hostname;
    return hostname === canonical || hostname === `www.${canonical}`;
  } catch {
    return false;
  }
}

/**
 * Whether a completed request should carry an HTTP noindex directive.
 *
 * Preview HTML must stay crawlable so a crawler can read the directive; that
 * is why preview robots.txt allows crawling instead of hiding every URL. Static
 * assets and server functions are not documents and must not inherit this
 * response policy.
 */
export function shouldNoIndexPreview(
  requestUrl: string,
  handlerType: string,
  contentType: string | null,
): boolean {
  return (
    handlerType !== "serverFn" &&
    !isCanonicalHost(requestUrl) &&
    contentType?.toLowerCase().includes("text/html") === true
  );
}

/** robots.txt for the requested host. Preview documents stay crawlable because
 * their HTTP noindex header is the indexing control; blocking them here would
 * prevent standards-compliant crawlers from ever seeing it. */
export function robotsTxt(requestUrl: string): string {
  if (!isCanonicalHost(requestUrl)) {
    return [
      "User-agent: *",
      "Allow: /",
      // Crawlers must fetch this response to see its X-Robots-Tag. The longer
      // allow rule wins over `/api/` while every other API route stays blocked.
      "Allow: /api/search",
      "Disallow: /api/",
      "Disallow: /_serverFn/",
      "",
    ].join("\n");
  }

  return [
    "User-agent: *",
    "Allow: /",
    "Allow: /api/search",
    "",
    "Disallow: /api/",
    "Disallow: /_serverFn/",
    "",
    `Sitemap: ${absoluteUrl("/sitemap.xml")}`,
    "",
  ].join("\n");
}

export const siteDescription =
  "Open-source, self-hosted PaaS: a Vercel and Railway alternative on your own servers. Git-push deploys, managed databases, automatic HTTPS, PR previews.";
