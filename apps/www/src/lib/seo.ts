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
  /** What the card shows, for screen readers and for crawlers that index it.
   *  Defaults to describing the standard card. */
  imageAlt?: string;
  /** Articles and reference pages are "article"; the landing page is a website. */
  type?: "website" | "article";
}

export function seo({
  title,
  description = siteDescription,
  path,
  image = "/og.png",
  imageAlt = "otterdeploy — calm, confident infrastructure. Self-hostable deployments: build, ship, and operate your services on your own servers.",
  type = "website",
}: SeoInput): MetaTag[] {
  // "otterdeploy" alone on the home page; "Getting started — otterdeploy"
  // elsewhere. Repeating the site name in front of itself reads as a bug.
  const fullTitle = title ? `${title} — otterdeploy` : `${appName} — deploy on your own servers`;
  const imageUrl = absoluteUrl(image);

  return [
    { title: fullTitle },
    { name: "description", content: description },

    { property: "og:title", content: fullTitle },
    { property: "og:description", content: description },
    { property: "og:type", content: type },
    { property: "og:url", content: absoluteUrl(path) },
    { property: "og:site_name", content: "otterdeploy" },
    { property: "og:locale", content: "en_US" },

    // The full set, not just `og:image`. Unfurlers differ in what they demand
    // before they'll render a card instead of dropping to a text-only preview:
    // WhatsApp reads `secure_url`, and several clients skip an image whose
    // type and dimensions they'd otherwise have to download the file to learn.
    // Dimensions must match the real asset (1200×630) — a mismatch reads as a
    // broken image to the stricter ones.
    { property: "og:image", content: imageUrl },
    { property: "og:image:secure_url", content: imageUrl },
    { property: "og:image:type", content: "image/png" },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: imageAlt },

    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: fullTitle },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: imageUrl },
    { name: "twitter:image:alt", content: imageAlt },
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
