import { describe, expect, test } from "bun:test";

import {
  inspectSeoHtml,
  parseSitemapLocations,
  type SeoPageSnapshot,
  validateSeoCorpus,
  validateSitemapLocations,
} from "../seo-corpus";

const ORIGIN = "https://otterdeploy.com";

function sitemap(...locations: string[]): string {
  return `<urlset>${locations.map((location) => `<url><loc>${location}</loc></url>`).join("")}</urlset>`;
}

function documentHtml({
  title,
  description,
  canonical,
  links,
  head = "",
  body = "",
}: {
  title: string;
  description: string;
  canonical: string;
  links: string[];
  head?: string;
  body?: string;
}): string {
  return [
    "<!doctype html><html><head>",
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`,
    `<link href="${canonical}" rel="canonical">`,
    head,
    "</head><body><h1>Page heading</h1>",
    ...links.map((href) => `<a href="${href}">Link</a>`),
    body,
    "</body></html>",
  ].join("");
}

function page(location: string, html: string): SeoPageSnapshot {
  return {
    location,
    status: 200,
    contentType: "text/html; charset=utf-8",
    xRobotsTag: null,
    html,
  };
}

describe("inspectSeoHtml", () => {
  test("reads crawler-visible tags independent of attribute order and decodes entities", () => {
    const signals = inspectSeoHtml(`
      <html><head>
        <title>Deploy &amp; operate</title>
        <meta content="A platform &amp; toolkit" name="description">
        <meta content="max-image-preview:large" name="robots">
        <link href="https://otterdeploy.com/docs" rel="stylesheet canonical">
      </head><body>
        <h1>Docs</h1>
        <a href="/docs?source=a&amp;medium=b">Docs</a>
        <img src="decorative.svg" alt="">
        <img src="meaningful.png">
        <svg><title>An icon title, not the document title</title></svg>
      </body></html>
    `);

    expect(signals).toEqual({
      titles: ["Deploy & operate"],
      descriptions: ["A platform & toolkit"],
      canonicals: [`${ORIGIN}/docs`],
      robots: ["max-image-preview:large"],
      h1Count: 1,
      headingLevels: [1],
      imagesWithoutAlt: 1,
      links: ["/docs?source=a&medium=b"],
    });
  });
});

describe("validateSitemapLocations", () => {
  test("rejects non-canonical hosts, duplicates, queries, fragments, and trailing slashes", () => {
    const issues = validateSitemapLocations(
      [
        `${ORIGIN}/docs`,
        `${ORIGIN}/docs`,
        `${ORIGIN}/guides/?page=1#top`,
        "https://www.otterdeploy.com/docs",
      ],
      ORIGIN,
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        `sitemap repeats ${ORIGIN}/docs`,
        `${ORIGIN}/guides/?page=1#top: sitemap URL contains a query or fragment`,
        `${ORIGIN}/guides/?page=1#top: sitemap URL has a trailing slash`,
        "https://www.otterdeploy.com/docs: sitemap URL must use https://otterdeploy.com",
      ]),
    );
  });

  test("decodes escaped locations from XML", () => {
    expect(parseSitemapLocations(`<loc>${ORIGIN}/docs?a=1&amp;b=2</loc>`)).toEqual([
      `${ORIGIN}/docs?a=1&b=2`,
    ]);
  });
});

describe("validateSeoCorpus", () => {
  test("accepts a linked corpus with complete, unique metadata", () => {
    const home = `${ORIGIN}/`;
    const docs = `${ORIGIN}/docs`;
    const issues = validateSeoCorpus(
      sitemap(home, docs),
      [
        page(
          home,
          documentHtml({
            title: "Self-hosted deployments",
            description: "Deploy applications on infrastructure you control.",
            canonical: home,
            links: ["/docs"],
            body: '<img src="dashboard.webp" alt="Deployment dashboard">',
          }),
        ),
        page(
          docs,
          documentHtml({
            title: "Documentation",
            description: "Install and operate otterdeploy.",
            canonical: docs,
            links: ["/"],
          }),
        ),
      ],
      ORIGIN,
    );

    expect(issues).toEqual([]);
  });

  test("hard-fails metadata, heading, canonical, image, indexing, and orphan regressions", () => {
    const home = `${ORIGIN}/`;
    const docs = `${ORIGIN}/docs`;
    const badHome = documentHtml({
      title: "Repeated title",
      description: "Repeated description",
      canonical: `${ORIGIN}/wrong?ref=bad`,
      links: ["/docs"],
      head: '<meta name="robots" content="noindex">',
      body: '<h1>Second heading</h1><h3>Skipped section</h3><img src="hero.png">',
    });
    const badDocs = documentHtml({
      title: "repeated title",
      description: "repeated description",
      canonical: docs,
      links: [],
    });
    const issues = validateSeoCorpus(
      sitemap(home, docs),
      [page(home, badHome), { ...page(docs, badDocs), xRobotsTag: "noindex, nofollow" }],
      ORIGIN,
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        `${home}: expected one H1, found 2`,
        `${home}: heading hierarchy jumps from H1 to H3`,
        `${home}: canonical points to https://otterdeploy.com/wrong?ref=bad`,
        `${home}: canonical contains a query or fragment`,
        `${home}: 1 image(s) have no alt attribute`,
        `${home}: a sitemap page is marked noindex`,
        `${docs}: duplicate title also used by ${home}`,
        `${docs}: duplicate meta description also used by ${home}`,
        `${docs}: a sitemap page is marked noindex`,
        `${home}: no internal link from another sitemap page`,
      ]),
    );
  });
});
