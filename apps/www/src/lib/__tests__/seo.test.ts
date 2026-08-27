/**
 * Guards on the tags a crawler and a link unfurler actually read.
 *
 * These exist because of a silent, total failure: `siteUrl` kept a fallback
 * pointing at the pre-Workers Vercel host, `.env` is gitignored so CI always
 * built with `VITE_SITE_URL` unset, and every absolute URL on the site shipped
 * pointing at a dead origin. Nothing broke loudly: the pages rendered, the
 * build passed, and only a link preview with a missing image gave it away.
 *
 * So the assertions below are about ORIGIN and ABSOLUTENESS, not formatting.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { canonical, seo } from "../seo";
import {
  absoluteUrl,
  DOCS_SECTIONS,
  docsSection,
  docsTitleSuffix,
  isCanonicalHost,
  siteUrl,
} from "../shared";

const content = (tags: ReturnType<typeof seo>, key: string): string | undefined => {
  const tag = tags.find(
    (t) => ("property" in t && t.property === key) || ("name" in t && t.name === key),
  );
  return tag && "content" in tag ? tag.content : undefined;
};

describe("siteUrl", () => {
  test("defaults to the production origin, with no trailing slash", () => {
    // The fallback IS the production value. CI builds with no VITE_SITE_URL.
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
    // public/og.png is 1200×630; a mismatch reads as a broken image to the
    // stricter unfurlers rather than being ignored.
    expect(content(tags, "og:image:width")).toBe("1200");
    expect(content(tags, "og:image:height")).toBe("630");
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

  test("puts the docs section between the page and the site name", () => {
    // "Install · otterdeploy" is 21 characters: Google shows about 60, so most
    // of the slot went unused and every reference page read the same way.
    const page = seo({
      title: "Install",
      section: "Start here",
      suffix: docsTitleSuffix,
      path: "/docs/start/install",
    });
    expect(content(page, "og:title")).toBe("Install · Start here · otterdeploy docs");
  });

  test("drops a section that would only repeat the page title", () => {
    // A section's own index page is titled after the section in the sidebar.
    // Without this it renders "HTTP API · HTTP API · otterdeploy docs".
    const page = seo({
      title: "HTTP API",
      section: "HTTP API",
      suffix: docsTitleSuffix,
      path: "/docs/openapi",
    });
    expect(content(page, "og:title")).toBe("HTTP API · otterdeploy docs");
  });

  test("the home page keeps its own full title, section or not", () => {
    expect(content(seo({ path: "/" }), "og:title")).toBe(
      "otterdeploy · self-hosted PaaS: git push, your own servers",
    );
  });

  test("the description fits the snippet Google actually renders", () => {
    // 186 characters shipped here once and lost its last clause in every
    // result. 160 is where the snippet is cut.
    const description = content(seo({ path: "/" }), "description");
    expect(description).toBeDefined();
    expect(description?.length).toBeLessThanOrEqual(160);
  });

  test("a per-page image override still resolves absolute", () => {
    const custom = seo({ path: "/docs", image: "/og-dark.png" });
    expect(content(custom, "og:image")).toBe("https://otterdeploy.com/og-dark.png");
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

describe("docsSection", () => {
  test("names the section a docs path sits in", () => {
    expect(docsSection("/docs/start/install")).toBe("Start here");
    expect(docsSection("/docs/guides/databases")).toBe("Guides");
    expect(docsSection("/docs/openapi/projects/create")).toBe("HTTP API");
  });

  test("has no section for the docs root or for anything outside the docs", () => {
    expect(docsSection("/docs")).toBeUndefined();
    expect(docsSection("/")).toBeUndefined();
    expect(docsSection("/pricing")).toBeUndefined();
  });

  test("stays in step with the section titles in content/docs", () => {
    // DOCS_SECTIONS is a copy of what each section's meta.json calls itself,
    // kept because the head tags are built from the URL before the page tree
    // exists. This is the assertion that stops the copy drifting: rename a
    // section in meta.json without touching the map and the titles would
    // quietly keep the old name.
    const root = join(import.meta.dir, "../../../content/docs");
    const onDisk: Record<string, string> = {};
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const meta: { title?: string } = JSON.parse(
        readFileSync(join(root, entry.name, "meta.json"), "utf8"),
      );
      if (meta.title) onDisk[entry.name] = meta.title;
    }
    expect(DOCS_SECTIONS).toEqual(onDisk);
  });
});
