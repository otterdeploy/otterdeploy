/**
 * Guards on the tags a crawler and a link unfurler actually read.
 *
 * These exist because of a silent, total failure: `siteUrl` once allowed a
 * build-specific origin and its fallback pointed at the pre-Workers Vercel
 * host. Every absolute URL on the site shipped pointing at a dead origin.
 * Nothing broke loudly: the pages rendered, the build passed, and only a link
 * preview with a missing image gave it away.
 *
 * So the assertions below are about ORIGIN and ABSOLUTENESS, not formatting.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  breadcrumbJsonLd,
  canonical,
  notFoundSeo,
  organizationJsonLd,
  seo,
  seoTitleOf,
  websiteJsonLd,
} from "../seo";
import {
  absoluteUrl,
  isCanonicalHost,
  machineReadableTextHeaders,
  robotsTxt,
  shouldNoIndexPreview,
  siteUrl,
} from "../shared";

const content = (tags: ReturnType<typeof seo>, key: string): string | undefined => {
  const tag = tags.find(
    (t) => ("property" in t && t.property === key) || ("name" in t && t.name === key),
  );
  return tag && "content" in tag ? tag.content : undefined;
};

interface BreadcrumbItem {
  name: string;
  item: string;
}

function isBreadcrumbItem(value: unknown): value is BreadcrumbItem {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "item" in value &&
    typeof value.item === "string"
  );
}

function breadcrumbElements(path: string, title: string): BreadcrumbItem[] {
  const parsed: unknown = JSON.parse(breadcrumbJsonLd(path, title));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("itemListElement" in parsed) ||
    !Array.isArray(parsed.itemListElement) ||
    !parsed.itemListElement.every(isBreadcrumbItem)
  ) {
    throw new Error("breadcrumb JSON-LD has an invalid itemListElement");
  }
  return parsed.itemListElement;
}

describe("siteUrl", () => {
  test("is the immutable production origin, with no trailing slash", () => {
    expect(siteUrl).toBe("https://otterdeploy.com");
  });

  test("never points at a host the site no longer runs on", () => {
    expect(siteUrl).not.toContain("vercel.app");
    expect(siteUrl).not.toContain("workers.dev");
  });
});

describe("absoluteUrl", () => {
  test("resolves site-relative paths against the canonical origin", () => {
    expect(absoluteUrl("/og.png")).toBe("https://otterdeploy.com/og.png");
    expect(absoluteUrl("/docs/start")).toBe("https://otterdeploy.com/docs/start");
  });

  test("tolerates a path without its leading slash", () => {
    expect(absoluteUrl("og.png")).toBe("https://otterdeploy.com/og.png");
  });
});

describe("seo", () => {
  const tags = seo({ path: "/" });

  test("every URL it emits is absolute", () => {
    // A relative og:image is the classic silent failure: it resolves against
    // the crawler's own base, not the page's, so the card just has no image.
    for (const key of ["og:url", "og:image", "og:image:secure_url", "twitter:image"]) {
      expect(content(tags, key)).toStartWith("https://");
    }
  });

  test("the card image is the real asset, on the real origin", () => {
    expect(content(tags, "og:image")).toBe("https://otterdeploy.com/og.png");
    // Unfurlers that read `secure_url` (WhatsApp among them) must not be
    // handed a different URL than `og:image`.
    expect(content(tags, "og:image:secure_url")).toBe(content(tags, "og:image"));
    expect(content(tags, "twitter:image")).toBe(content(tags, "og:image"));
  });

  test("declares the dimensions and type of the asset that actually ships", () => {
    // Read the PNG's IHDR rather than repeating the intended size in the test.
    // A later asset replacement must update the metadata or this fails.
    const image = readFileSync(new URL("../../../public/og.png", import.meta.url));
    expect(image.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(content(tags, "og:image:width")).toBe(String(image.readUInt32BE(16)));
    expect(content(tags, "og:image:height")).toBe(String(image.readUInt32BE(20)));
    expect(content(tags, "og:image:type")).toBe("image/png");
  });

  test("carries alt text on both cards", () => {
    expect(content(tags, "og:image:alt")).toBeTruthy();
    expect(content(tags, "twitter:image:alt")).toBe(content(tags, "og:image:alt"));
  });

  test("titles a sub-page without repeating the site name twice", () => {
    const sub = seo({ title: "Getting started", path: "/docs" });
    expect(content(sub, "og:title")).toBe("Getting started · otterdeploy");
    expect(content(sub, "og:url")).toBe("https://otterdeploy.com/docs");
  });

  test("a per-page image override still resolves absolute", () => {
    const custom = seo({ path: "/docs", image: "/og-dark.png" });
    expect(content(custom, "og:image")).toBe("https://otterdeploy.com/og-dark.png");
  });

  test("leaves index/follow implicit so preview HTTP noindex is unambiguous", () => {
    expect(content(tags, "robots")).toBe(
      "max-image-preview:large, max-snippet:-1, max-video-preview:-1",
    );
  });

  test("can keep a generated reference crawlable without indexing it", () => {
    const generated = seo({
      title: "List projects",
      path: "/docs/openapi/projects/get",
      indexable: false,
    });
    expect(content(generated, "robots")).toStartWith("noindex, follow,");
  });
});

describe("notFoundSeo", () => {
  const tags = notFoundSeo();

  test("is distinct, noindex metadata with no misleading URL", () => {
    expect(tags).toContainEqual({ title: "Page not found · otterdeploy" });
    expect(content(tags, "robots")).toBe("noindex, nofollow");
    expect(content(tags, "og:url")).toBeUndefined();
  });
});

describe("seoTitleOf", () => {
  test("uses an optional search title without changing the page title", () => {
    expect(seoTitleOf({ title: "Install", seoTitle: "Install on a Linux server" })).toBe(
      "Install on a Linux server",
    );
  });

  test("falls back to the visible title", () => {
    expect(seoTitleOf({ title: "Install" })).toBe("Install");
  });
});

describe("canonical", () => {
  test("points at the production origin, not the deployment's own host", () => {
    // Pointing this at a preview or a stale host tells Google to index that
    // host instead: the reason the real domain can be absent from results.
    expect(canonical("/docs").href).toBe("https://otterdeploy.com/docs");
  });
});

describe("isCanonicalHost", () => {
  test("accepts the apex and www, both of which serve production", () => {
    expect(isCanonicalHost("https://otterdeploy.com/robots.txt")).toBe(true);
    expect(isCanonicalHost("https://www.otterdeploy.com/robots.txt")).toBe(true);
  });

  test("rejects previews and local dev, which must not be indexed", () => {
    expect(isCanonicalHost("https://otterdeploy-www.workers.dev/robots.txt")).toBe(false);
    expect(isCanonicalHost("https://otterdeploy-www-pr-12.workers.dev/robots.txt")).toBe(false);
    expect(isCanonicalHost("http://localhost:3002/robots.txt")).toBe(false);
  });

  test("rejects a lookalike host rather than matching on a substring", () => {
    expect(isCanonicalHost("https://otterdeploy.com.evil.test/robots.txt")).toBe(false);
    expect(isCanonicalHost("https://nototterdeploy.com/robots.txt")).toBe(false);
  });

  test("answers false when the URL can't be parsed", () => {
    // The caller uses this to decide whether to ALLOW indexing, so the safe
    // answer under uncertainty is the restrictive one.
    expect(isCanonicalHost("not a url")).toBe(false);
    expect(isCanonicalHost("")).toBe(false);
  });
});

describe("preview indexing policy", () => {
  test("adds noindex only to preview HTML documents", () => {
    expect(
      shouldNoIndexPreview(
        "https://otterdeploy-www-pr-12.workers.dev/docs",
        "request",
        "text/html; charset=utf-8",
      ),
    ).toBe(true);
    expect(shouldNoIndexPreview("https://preview.example.com/docs", "request", "TEXT/HTML")).toBe(
      true,
    );
    expect(shouldNoIndexPreview("https://otterdeploy.com/docs", "request", "text/html")).toBe(
      false,
    );
    expect(
      shouldNoIndexPreview(
        "https://otterdeploy-www-pr-12.workers.dev/app.js",
        "request",
        "application/javascript",
      ),
    ).toBe(false);
  });

  test("never adds noindex to a server function response", () => {
    expect(
      shouldNoIndexPreview(
        "https://otterdeploy-www-pr-12.workers.dev/_server",
        "serverFn",
        "text/html",
      ),
    ).toBe(false);
  });

  test("keeps preview pages crawlable so their noindex header can be read", () => {
    const preview = robotsTxt("https://otterdeploy-www-pr-12.workers.dev/robots.txt");
    expect(preview).toContain("Allow: /");
    expect(preview).toContain("Allow: /api/search");
    expect(preview.split("\n")).not.toContain("Disallow: /");
    expect(preview).toContain("Disallow: /api/");
    expect(preview).toContain("Disallow: /_serverFn/");
    expect(preview).not.toContain("Disallow: /docs/openapi");
    expect(preview).not.toContain("Sitemap:");
  });

  test("advertises the production sitemap only on production", () => {
    const production = robotsTxt("https://otterdeploy.com/robots.txt");
    expect(production).toContain("Allow: /api/search");
    expect(production).toContain("Disallow: /api/");
    expect(production).toContain("Disallow: /_serverFn/");
    // Generated operation pages are internally discoverable and carry HTTP/
    // meta noindex. They must remain crawlable for bots to read that policy.
    expect(production).not.toContain("Disallow: /docs/openapi");
    expect(production).toContain("Sitemap: https://otterdeploy.com/sitemap.xml");
  });
});

describe("machine-readable documentation", () => {
  test("stays crawlable without competing with canonical HTML pages", () => {
    expect(machineReadableTextHeaders).toMatchObject({
      "content-type": "text/plain; charset=utf-8",
      "x-robots-tag": "noindex, follow",
    });
  });
});

describe("structured data", () => {
  test("uses an Organization logo that meets the 112px minimum", () => {
    const organization = JSON.parse(organizationJsonLd());
    expect(organization.logo).toEqual({
      "@type": "ImageObject",
      url: "https://otterdeploy.com/icon-512.png",
      width: 512,
      height: 512,
    });
  });

  test("describes the official website separately from the application", () => {
    const website = JSON.parse(websiteJsonLd());
    expect(website).toMatchObject({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "otterdeploy",
      url: "https://otterdeploy.com",
    });
  });
});

describe("breadcrumbJsonLd", () => {
  test("skips navigation-only folder names that are real 404s", () => {
    for (const [path, title, nonexistentParent] of [
      ["/docs/start/install", "Install", "https://otterdeploy.com/docs/start"],
      ["/docs/guides/backups", "Backups and restore", "https://otterdeploy.com/docs/guides"],
      ["/docs/reference/manifest", "Manifest", "https://otterdeploy.com/docs/reference"],
    ]) {
      const urls = breadcrumbElements(path, title).map((item) => item.item);
      expect(urls).toEqual([
        "https://otterdeploy.com",
        "https://otterdeploy.com/docs",
        `https://otterdeploy.com${path}`,
      ]);
      expect(urls).not.toContain(nonexistentParent);
    }
  });

  test("cannot be broken out of its script element by an OpenAPI title", () => {
    const hostileTitle = "</script><script>alert('x')</script>&\u2028\u2029";
    const serialized = breadcrumbJsonLd("/docs/openapi/hostile", hostileTitle);

    expect(serialized).not.toContain("<");
    expect(serialized).not.toContain(">");
    expect(serialized).not.toContain("&");
    expect(serialized).not.toContain("\u2028");
    expect(serialized).not.toContain("\u2029");

    expect(breadcrumbElements("/docs/openapi/hostile", hostileTitle).at(-1)?.name).toBe(
      hostileTitle,
    );
  });

  test("preserves the real CLI parent for its child page", () => {
    const breadcrumbs = breadcrumbElements("/docs/cli/commands", "Command reference");
    expect(breadcrumbs.map((item) => [item.name, item.item])).toEqual([
      ["otterdeploy", "https://otterdeploy.com"],
      ["Docs", "https://otterdeploy.com/docs"],
      ["CLI", "https://otterdeploy.com/docs/cli"],
      ["Command reference", "https://otterdeploy.com/docs/cli/commands"],
    ]);
  });

  test("preserves the stable API overview for generated operation pages", () => {
    const breadcrumbs = breadcrumbElements("/docs/openapi/projects/list", "List projects");
    expect(breadcrumbs.map((item) => [item.name, item.item])).toEqual([
      ["otterdeploy", "https://otterdeploy.com"],
      ["Docs", "https://otterdeploy.com/docs"],
      ["HTTP API operations", "https://otterdeploy.com/docs/openapi"],
      ["List projects", "https://otterdeploy.com/docs/openapi/projects/list"],
    ]);
  });

  test("does not duplicate /docs when it is the leaf", () => {
    const breadcrumbs = breadcrumbElements("/docs", "Introduction");
    expect(breadcrumbs.map((item) => item.item)).toEqual([
      "https://otterdeploy.com",
      "https://otterdeploy.com/docs",
    ]);
  });
});
