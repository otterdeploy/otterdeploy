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
 * hydration — which is exactly the sort of thing a crawler catches and a
 * human never does.
 *
 * Set `VITE_SITE_URL` per environment. The fallback is the host this site is
 * actually served from today; change it when a custom domain is attached, or
 * previews will advertise the production URL as their canonical.
 */
export const siteUrl = (
  import.meta.env.VITE_SITE_URL ?? "https://otterdeploy-www.vercel.app"
).replace(/\/$/, "");

/** Absolute URL for a site-relative path. Crawlers and og: tags need absolute. */
export const absoluteUrl = (path: string) =>
  `${siteUrl}${path.startsWith("/") ? path : `/${path}`}`;

export const siteDescription =
  "A self-hostable deployment platform. Build from a git repo, run managed databases, get automatic HTTPS and per-PR previews — on servers you own.";
