import { createFileRoute } from "@tanstack/react-router";

import { absoluteUrl, docsRoute } from "@/lib/shared";
import { source } from "@/lib/source";

/**
 * The sitemap, generated from the same `source` the docs navigation is built
 * from — so a page can't exist in the sidebar and be missing here, which is
 * the usual way a hand-maintained sitemap goes stale.
 *
 * Served at /sitemap.xml; the filename uses `[.]` because TanStack Router
 * treats a bare dot as a route-nesting separator.
 */

interface Entry {
  loc: string;
  priority: string;
}

function xml(entries: Entry[]): string {
  const urls = entries
    .map((e) => `  <url>\n    <loc>${e.loc}</loc>\n    <priority>${e.priority}</priority>\n  </url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => {
        const entries: Entry[] = [
          { loc: absoluteUrl("/"), priority: "1.0" },
          { loc: absoluteUrl(docsRoute), priority: "0.8" },
        ];

        for (const page of source.getPages()) {
          if (page.url === docsRoute) continue;
          entries.push({
            loc: absoluteUrl(page.url),
            // The generated OpenAPI operation pages are reference material —
            // real, indexable, but not what anyone should land on first.
            priority: page.url.startsWith(`${docsRoute}/openapi`) ? "0.3" : "0.6",
          });
        }

        return new Response(xml(entries), {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, max-age=0, s-maxage=3600",
          },
        });
      },
    },
  },
});
