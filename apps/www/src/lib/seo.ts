import { absoluteUrl, appName, siteDescription, siteUrl } from "./shared";

/**
 * Head-tag builders shared by every route.
 *
 * One place decides what a page says to a crawler and to a link unfurler, so
 * a new route can't ship with a title and nothing else. Every URL emitted here
 * is absolute — `og:image` and `canonical` are resolved against the crawler's
 * own base, not the page's, and relative values there are a common silent
 * failure.
 */

type MetaTag =
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string };

export interface SeoInput {
  /** Page title, without the site suffix. Omit on the home page. */
  title?: string;
  description?: string;
  /** Site-relative path, e.g. "/docs/start/first-deploy". */
  path: string;
  /** Overrides the default social card. Site-relative. */
  image?: string;
  /** Articles and reference pages are "article"; the landing page is a website. */
  type?: "website" | "article";
}

export function seo({
  title,
  description = siteDescription,
  path,
  image = "/og.png",
  type = "website",
}: SeoInput): MetaTag[] {
  // "otterdeploy" alone on the home page; "Getting started — otterdeploy"
  // elsewhere. Repeating the site name in front of itself reads as a bug.
  const fullTitle = title ? `${title} — otterdeploy` : `${appName} — deploy on your own servers`;

  return [
    { title: fullTitle },
    { name: "description", content: description },

    { property: "og:title", content: fullTitle },
    { property: "og:description", content: description },
    { property: "og:type", content: type },
    { property: "og:url", content: absoluteUrl(path) },
    { property: "og:image", content: absoluteUrl(image) },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:site_name", content: "otterdeploy" },

    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: fullTitle },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: absoluteUrl(image) },
  ];
}

/** The canonical link for a page. Paired with `seo()` on every route. */
export const canonical = (path: string) => ({
  rel: "canonical" as const,
  href: absoluteUrl(path),
});

/**
 * schema.org SoftwareApplication for the home page. Search engines use this to
 * render the name, category and licence; keeping it honest matters as much
 * here as in the visible copy, so the licence is the real one.
 */
export function softwareJsonLd(): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "otterdeploy",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Linux",
    description: siteDescription,
    url: siteUrl,
    license: "https://www.gnu.org/licenses/agpl-3.0.html",
    isAccessibleForFree: true,
    softwareHelp: absoluteUrl("/docs"),
    codeRepository: "https://github.com/otterdeploy/otterdeploy",
  });
}
