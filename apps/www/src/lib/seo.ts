import { absoluteUrl, appName, docsRoute, siteDescription, siteUrl } from "./shared";

/**
 * Head-tag builders shared by every route.
 *
 * One place decides what a page says to a crawler and to a link unfurler, so
 * a new route can't ship with a title and nothing else. Every URL emitted here
 * is absolute. `og:image` and `canonical` are resolved against the crawler's
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
  /** Generated/supporting pages can stay crawlable without entering the index. */
  indexable?: boolean;
}

export function seo({
  title,
  description = siteDescription,
  path,
  image = "/og.png",
  imageAlt = "otterdeploy: calm, confident infrastructure. Self-hostable deployments: build, ship, and operate your services on your own servers.",
  type = "website",
  indexable = true,
}: SeoInput): MetaTag[] {
  // "otterdeploy" alone on the home page, "Getting started · otterdeploy"
  // elsewhere. Repeating the site name in front of itself reads as a bug.
  const fullTitle = title
    ? `${title} · otterdeploy`
    : `${appName} · self-hosted PaaS: git push, your own servers`;
  const imageUrl = absoluteUrl(image);

  return [
    { title: fullTitle },
    { name: "description", content: description },

    // Let search engines show a full-size image and an unlimited-length
    // snippet. The defaults are conservative: Google truncates snippets and
    // shows a thumbnail unless told otherwise, which loses the card on a
    // result for a page whose whole job is explaining what this software is.
    {
      name: "robots",
      // Index/follow stay implicit on normal pages so preview deployments can
      // add a stricter X-Robots-Tag without opposing directives. Generated
      // support pages opt out of indexing while leaving link discovery on.
      content: [
        ...(indexable ? [] : ["noindex", "follow"]),
        "max-image-preview:large",
        "max-snippet:-1",
        "max-video-preview:-1",
      ].join(", "),
    },

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
    // Dimensions must match the real asset (1200×630). A mismatch reads as a
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

/**
 * Serialize data for an inline JSON-LD script without allowing a value to
 * close the script element. JSON escapes alone do not protect `</script>` in
 * HTML parsing, so encode the five HTML-sensitive/separator characters as
 * JSON Unicode escapes. JSON.parse reconstructs the original values.
 */
function jsonLdStringify(value: unknown): string {
  const unsafeCharacters: Record<string, string> = {
    "&": "\\u0026",
    "<": "\\u003c",
    ">": "\\u003e",
    "\u2028": "\\u2028",
    "\u2029": "\\u2029",
  };

  return JSON.stringify(value).replace(
    /[&<>\u2028\u2029]/g,
    (character) => unsafeCharacters[character] ?? character,
  );
}

/** The canonical link for a page. Paired with `seo()` on every route. */
export const canonical = (path: string) => ({
  rel: "canonical" as const,
  href: absoluteUrl(path),
});

/** Metadata for a response that really returned 404. Deliberately contains no
 * canonical or og:url: a missing URL must not lend its signals to `/` or
 * `/docs`, and there is no indexable document to make canonical. */
export function notFoundSeo(): MetaTag[] {
  return [
    { title: "Page not found · otterdeploy" },
    {
      name: "description",
      content: "The requested page could not be found on the otterdeploy site.",
    },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

/** Keep a concise navigation/H1 title unless the page explicitly supplies a
 * richer search-result title. */
export function seoTitleOf(page: { title: string; seoTitle?: string }): string {
  return page.seoTitle ?? page.title;
}

/**
 * schema.org SoftwareApplication for the home page. Search engines use this to
 * render the name, category and licence; keeping it honest matters as much
 * here as in the visible copy, so the licence is the real one.
 */
export function softwareJsonLd(): string {
  return jsonLdStringify({
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
    applicationSubCategory: "Deployment Platform",
    // Free as in no price, stated in the vocabulary a rich result renders.
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    sameAs: ["https://github.com/otterdeploy/otterdeploy"],
  });
}

/**
 * schema.org Organization for the project itself.
 *
 * Separate from the SoftwareApplication above: one describes the thing you
 * install, this describes who publishes it. Search engines use it to link the
 * site, the repository and the name together instead of treating each mention
 * as an unrelated string.
 */
export function organizationJsonLd(): string {
  return jsonLdStringify({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "otterdeploy",
    url: siteUrl,
    description: siteDescription,
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl("/icon-512.png"),
      width: 512,
      height: 512,
    },
    sameAs: ["https://github.com/otterdeploy/otterdeploy"],
  });
}

/** The website entity complements the software and publisher entities on the
 * home page. It describes this URL as the official site, not another copy of
 * the application itself. */
export function websiteJsonLd(): string {
  return jsonLdStringify({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "otterdeploy",
    url: siteUrl,
    description: siteDescription,
  });
}

/**
 * schema.org BreadcrumbList for a docs page.
 *
 * Turns the result's second line from a raw URL into a trail of real pages.
 * Most docs folders are navigation groups, not routes, so only known,
 * indexable parent pages may appear. In particular, `/docs/start`,
 * `/docs/guides` and `/docs/reference` are intentionally skipped.
 */
export function breadcrumbJsonLd(path: string, title: string): string {
  const normalizedPath = path !== "/" ? path.replace(/\/+$/, "") : path;
  const items = [{ name: "otterdeploy", item: siteUrl }];

  const realParents = [
    { path: docsRoute, name: "Docs" },
    { path: `${docsRoute}/cli`, name: "CLI" },
    { path: `${docsRoute}/openapi`, name: "HTTP API operations" },
  ];
  for (const parent of realParents) {
    if (normalizedPath !== parent.path && normalizedPath.startsWith(`${parent.path}/`)) {
      items.push({ name: parent.name, item: absoluteUrl(parent.path) });
    }
  }

  items.push({ name: title, item: absoluteUrl(normalizedPath) });

  return jsonLdStringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((entry, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: entry.name,
      item: entry.item,
    })),
  });
}
