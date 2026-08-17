import { createFileRoute } from "@tanstack/react-router";

import { absoluteUrl, isCanonicalHost } from "@/lib/shared";

/**
 * robots.txt.
 *
 * A route rather than a static file for one reason: preview deployments must
 * not be indexed. Each gets its own public URL. Left open, they compete with
 * production for the same queries and leak unreleased copy into search
 * results. Production serves the permissive version; everything else is
 * closed.
 *
 * "Production" is decided by the host that was actually asked, not by an env
 * var. This gate used to read `VERCEL_ENV`, which no longer exists anywhere
 * after the move to Workers: `!process.env.VERCEL_ENV` was true on every
 * deployment, so every preview served the permissive version. The host is
 * something Workers genuinely knows.
 */
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const body = isCanonicalHost(request.url)
          ? [
              "User-agent: *",
              "Allow: /",
              "",
              // The search index is a JSON API, not a page. Nothing to rank.
              "Disallow: /api/",
              "",
              `Sitemap: ${absoluteUrl("/sitemap.xml")}`,
              "",
            ].join("\n")
          : ["User-agent: *", "Disallow: /", ""].join("\n");

        return new Response(body, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=0, s-maxage=3600",
          },
        });
      },
    },
  },
});
