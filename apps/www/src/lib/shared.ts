export const appName = "Otterdeploy";
export const docsRoute = "/docs";

/**
 * The canonical origin, with no trailing slash.
 *
 * Read from `import.meta.env` rather than `process.env` on purpose: Vite
 * inlines it at build time for BOTH the server and the client bundle, so the
 * canonical link and og:url rendered during SSR are byte-identical to what
 * hydration produces. Reading `process.env` here would give the server a real
 * value and the client `undefined`, and React would swap the tags out on
 * hydration, which is exactly the sort of thing a crawler catches and a
 * human never does.
 *
 * The fallback is the production origin, matching the `custom_domain` route in
 * `apps/www/wrangler.jsonc`, not a build-time requirement. `.env` is
 * gitignored, so CI builds with `VITE_SITE_URL` unset and whatever stands here
 * is what ships; a fallback pointing anywhere else is a silent outage of every
 * absolute URL on the site. It stayed on the pre-Workers Vercel host through
 * the migration, which sent `og:image` and `twitter:image` to a 404 (link
 * unfurls lost their card), pointed `canonical` at a dead origin, and filled
 * robots.txt + every `<loc>` in the sitemap with unreachable URLs.
 *
 * Set `VITE_SITE_URL` to override for a preview deployment, so it doesn't
 * advertise production as its canonical.
 */
export const siteUrl = (import.meta.env.VITE_SITE_URL ?? "https://otterdeploy.com").replace(
  /\/$/,
  "",
);

/** Absolute URL for a site-relative path. Crawlers and og: tags need absolute. */
export const absoluteUrl = (path: string) =>
  `${siteUrl}${path.startsWith("/") ? path : `/${path}`}`;

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

export const siteDescription =
  "A self-hostable deployment platform. Build from a git repo, run managed databases, get automatic HTTPS and per-PR previews. On servers you own.";
