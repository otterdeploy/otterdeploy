import { describe, expect, test } from "bun:test";

import { isIndexableDocsPage, lastmodOf, sitemapEntries, sitemapXml } from "../sitemap";

describe("lastmodOf", () => {
  test("uses the git-backed Date emitted by Fumadocs", () => {
    expect(lastmodOf({ lastModified: new Date("2026-08-10T21:34:24.000Z") })).toBe(
      "2026-08-10T21:34:24.000Z",
    );
  });

  test("omits missing, invalid and invented string dates", () => {
    expect(lastmodOf({})).toBeUndefined();
    expect(lastmodOf({ lastModified: new Date(Number.NaN) })).toBeUndefined();
    expect(lastmodOf({ lastModified: "2026-08-10" })).toBeUndefined();
  });
});

describe("sitemapEntries", () => {
  const docsDate = new Date("2026-08-10T21:34:24.000Z");
  const pages = [
    { url: "/docs", data: { lastModified: docsDate } },
    { url: "/docs/start/install", data: {} },
    {
      url: "/docs/openapi/projects/get",
      data: { _openapi: { method: "get" } },
    },
  ];
  const entries = sitemapEntries(pages, true);

  test("does not borrow a docs date for the independently edited homepage", () => {
    expect(entries[0]).toEqual({ loc: "https://otterdeploy.com/" });
  });

  test("includes the linked standalone privacy page without an invented date", () => {
    expect(entries[1]).toEqual({ loc: "https://otterdeploy.com/privacy" });
  });

  test("includes /docs once with its own truthful source date", () => {
    expect(entries.filter((entry) => entry.loc === "https://otterdeploy.com/docs")).toEqual([
      {
        loc: "https://otterdeploy.com/docs",
        lastmod: "2026-08-10T21:34:24.000Z",
      },
    ]);
  });

  test("omits lastmod for a page whose source date is unavailable", () => {
    expect(entries.at(-1)).toEqual({
      loc: "https://otterdeploy.com/docs/start/install",
      lastmod: undefined,
    });
    expect(sitemapXml(entries)).not.toContain("undefined");
  });

  test("suppresses every date when the build checkout is shallow", () => {
    const shallowEntries = sitemapEntries(pages, false);
    expect(shallowEntries.every((entry) => entry.lastmod === undefined)).toBe(true);
    expect(sitemapXml(shallowEntries)).not.toContain("<lastmod>");
  });

  test("keeps authored pages and excludes generated OpenAPI operation pages", () => {
    expect(isIndexableDocsPage({ url: "/docs/openapi", data: {} })).toBe(true);
    expect(
      isIndexableDocsPage({
        url: "/docs/openapi/projects/get",
        data: { _openapi: { method: "get" } },
      }),
    ).toBe(false);
    expect(entries.map((entry) => entry.loc)).not.toContain(
      "https://otterdeploy.com/docs/openapi/projects/get",
    );
  });
});
