import { absoluteUrl } from "./shared";

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

interface SitemapPage {
  url: string;
  data: unknown;
}

/** Fumadocs marks every virtual OpenAPI operation page with `_openapi`. */
export function isIndexableDocsPage<Page extends SitemapPage>(page: Page): boolean {
  return !(typeof page.data === "object" && page.data !== null && "_openapi" in page.data);
}

/** W3C date from Fumadocs' git-backed last-modified plugin. Missing or invalid
 * dates are omitted rather than replaced with deploy time, which would tell a
 * crawler that unchanged content is fresh on every build. */
export function lastmodOf(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null || !("lastModified" in data)) return undefined;
  const value = data.lastModified;
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : undefined;
}

/** Build entries from explicit standalone pages and authored docs pages.
 * Virtual OpenAPI operations are deliberately omitted while the new site's
 * crawl footprint stays focused. The standalone pages have no trustworthy
 * source date in this collection, so they have no lastmod. Docs dates are
 * emitted only when the build proved its Git history complete; shallow history
 * makes Git invent a boundary date for old files. */
export function sitemapEntries(
  pages: readonly SitemapPage[],
  includeLastModified: boolean,
): SitemapEntry[] {
  return [
    { loc: absoluteUrl("/") },
    { loc: absoluteUrl("/privacy") },
    ...pages.filter(isIndexableDocsPage).map((page) => ({
      loc: absoluteUrl(page.url),
      lastmod: includeLastModified ? lastmodOf(page.data) : undefined,
    })),
  ];
}

export function sitemapXml(entries: SitemapEntry[]): string {
  const urls = entries
    .map((entry) => {
      const lastmod = entry.lastmod ? `\n    <lastmod>${entry.lastmod}</lastmod>` : "";
      return `  <url>\n    <loc>${entry.loc}</loc>${lastmod}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
