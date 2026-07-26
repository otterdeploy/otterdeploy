import { createFileRoute } from "@tanstack/react-router";

import { absoluteUrl } from "@/lib/shared";

/**
 * robots.txt.
 *
 * A route rather than a static file for one reason: preview deployments must
 * not be indexed. Vercel sets `VERCEL_ENV` to "preview" on every branch and PR
 * build, and each of those gets its own public URL — left open, they compete
 * with production for the same queries and leak unreleased copy into search
 * results. Production serves the permissive version; everything else is
 * closed.
 */
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () => {
        // oxlint-disable-next-line node/no-process-env
        const isProduction = process.env.VERCEL_ENV === "production" || !process.env.VERCEL_ENV;

        const body = isProduction
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
