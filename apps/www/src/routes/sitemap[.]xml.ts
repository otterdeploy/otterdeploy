import { createFileRoute } from "@tanstack/react-router";

import { absoluteUrl, docsRoute } from "@/lib/shared";
import { source } from "@/lib/source";

/**
 * The sitemap, generated from the same `source` the docs navigation is built
 * from, so a page can't exist in the sidebar and be missing here, which is
 * the usual way a hand-maintained sitemap goes stale.
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

interface Entry {
  loc: string;
  lastmod?: string;
}

/** W3C date, which is what the sitemap schema wants. Undefined when the build
 *  had no git history to read (a shallow clone), so the tag is omitted rather
 *  than filled with today's date on every deploy. */
function lastmodOf(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null || !("lastModified" in data)) return undefined;
  const value = data.lastModified;
  return value instanceof Date ? value.toISOString() : undefined;
}

function xml(entries: Entry[]): string {
  const urls = entries
    .map((e) => {
      const lastmod = e.lastmod ? `\n    <lastmod>${e.lastmod}</lastmod>` : "";
      return `  <url>\n    <loc>${e.loc}</loc>${lastmod}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => {
        const pages = source.getPages();

        // The home page's freshness is the freshest thing on the site: it is
        // the page most likely to have changed when anything else did.
        const newest = pages
          .map((p) => lastmodOf(p.data))
          .filter((d): d is string => d !== undefined)
          .sort()
          .at(-1);

        const entries: Entry[] = [
          { loc: absoluteUrl("/"), lastmod: newest },
          { loc: absoluteUrl(docsRoute) },
        ];

        for (const page of pages) {
          if (page.url === docsRoute) continue;
          entries.push({ loc: absoluteUrl(page.url), lastmod: lastmodOf(page.data) });
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
