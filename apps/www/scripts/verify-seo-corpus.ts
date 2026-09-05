#!/usr/bin/env bun

import process from "node:process";

import {
  parseSitemapLocations,
  type SeoPageSnapshot,
  validateSeoCorpus,
  validateSitemapLocations,
} from "../src/lib/seo-corpus";
import { siteUrl } from "../src/lib/shared";

const REQUEST_TIMEOUT_MS = 15_000;
const CRAWLER_USER_AGENT = "OtterdeploySeoBot/1.0 (+https://otterdeploy.com)";

function option(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index < 0 ? undefined : args[index + 1];
  if (!value) throw new Error(`usage: verify-seo-corpus.ts ${name} <url>`);
  return value;
}

async function fetchDocument(location: string, baseUrl: URL): Promise<SeoPageSnapshot> {
  const canonical = new URL(location);
  const requestUrl = new URL(`${canonical.pathname}${canonical.search}`, baseUrl);
  const response = await fetch(requestUrl, {
    redirect: "manual",
    headers: {
      accept: "text/html",
      "user-agent": CRAWLER_USER_AGENT,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  return {
    location,
    status: response.status,
    contentType: response.headers.get("content-type"),
    xRobotsTag: response.headers.get("x-robots-tag"),
    html: await response.text(),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const baseUrl = new URL(option(args, "--base"));
  const expectPreviewNoindex = args.includes("--expect-preview-noindex");
  const sitemapUrl = new URL("/sitemap.xml", baseUrl);
  const response = await fetch(sitemapUrl, {
    redirect: "manual",
    headers: { "user-agent": CRAWLER_USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status !== 200) {
    throw new Error(`${sitemapUrl.href}: expected HTTP 200, received ${response.status}`);
  }

  const sitemapXml = await response.text();
  const locations = parseSitemapLocations(sitemapXml);
  const sitemapIssues = validateSitemapLocations(locations, siteUrl);
  if (sitemapIssues.length > 0) {
    throw new Error(
      `SEO corpus failed:\n${sitemapIssues.map((issue) => `  - ${issue}`).join("\n")}`,
    );
  }

  const fetchedPages = await Promise.all(
    locations.map((location) => fetchDocument(location, baseUrl)),
  );

  // CI deliberately serves the built Worker on localhost. That host must carry
  // the preview noindex header even though each document's canonical points at
  // production. Require the safety header in this mode, then remove only that
  // expected transport signal before applying the production corpus rules.
  const pages = expectPreviewNoindex
    ? fetchedPages.map((page) => {
        if (!/\bnoindex\b/i.test(page.xRobotsTag ?? "")) {
          throw new Error(
            `${page.location}: local preview response is missing X-Robots-Tag noindex`,
          );
        }
        return { ...page, xRobotsTag: null };
      })
    : fetchedPages;

  const issues = validateSeoCorpus(sitemapXml, pages, siteUrl);
  if (issues.length > 0) {
    throw new Error(`SEO corpus failed:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
  }

  // oxlint-disable-next-line no-console -- this CLI's output is its user interface
  console.log(`SEO corpus passed: ${locations.length} canonical, indexable pages`);
}

try {
  await main();
} catch (error) {
  // oxlint-disable-next-line no-console -- this CLI's output is its user interface
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
