import { createFileRoute } from "@tanstack/react-router";

import { sitemapEntries, sitemapXml } from "@/lib/sitemap";
import { source } from "@/lib/source";

/**
 * The sitemap is generated from the authored docs source, with a second
 * explicit guard against virtual OpenAPI operation pages. The stable API
 * overview is indexable; hundreds of generated leaf URLs are intentionally
 * left out while the site's search footprint is still new.
 *
 * Carries <lastmod> from the page's last git commit (see the `lastModified`
 * plugin in source.config.ts) and nothing else. `<priority>` and
 * `<changefreq>` used to be here; Google has said for years that it ignores
 * both, and they cost a line each to keep honest. A real modification date is
 * the one hint that still changes crawl behaviour.
 *
 * Served at /sitemap.xml; the filename uses `[.]` because TanStack Router
 * treats a bare dot as a route-nesting separator.
 */

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => {
        const pages = source.getPages();
        return new Response(sitemapXml(sitemapEntries(pages, __DOCS_GIT_HISTORY_COMPLETE__)), {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, max-age=0, s-maxage=3600",
          },
        });
      },
    },
  },
});
