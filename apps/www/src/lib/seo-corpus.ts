/**
 * Hard SEO invariants for the indexable page corpus.
 *
 * The private SEO crawler intentionally reports several useful findings as
 * advisory tiers. This module owns the smaller set that must make CI fail: the
 * sitemap is canonical, every listed URL renders a complete SSR document, and
 * the corpus has no duplicate metadata or orphan pages.
 */

import {
  indexSeoPages,
  validateCanonical,
  validateIndexability,
  validateRequiredSignals,
  validateResponse,
} from "./seo-corpus-rules";

export interface SeoPageSnapshot {
  location: string;
  status: number;
  contentType: string | null;
  xRobotsTag: string | null;
  html: string;
}

export interface SeoDocumentSignals {
  titles: string[];
  descriptions: string[];
  canonicals: string[];
  robots: string[];
  h1Count: number;
  headingLevels: number[];
  imagesWithoutAlt: number;
  links: string[];
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|quot);/gi, (entity, code: string) => {
    if (!code.startsWith("#")) return NAMED_ENTITIES[code.toLowerCase()] ?? entity;

    const radix = code[1]?.toLowerCase() === "x" ? 16 : 10;
    const digits = radix === 16 ? code.slice(2) : code.slice(1);
    const point = Number.parseInt(digits, radix);
    return Number.isSafeInteger(point) && point >= 0 && point <= 0x10ffff
      ? String.fromCodePoint(point)
      : entity;
  });
}

function normalizedText(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function tagsNamed(html: string, name: string): string[] {
  return Array.from(html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi")), (match) => match[0]);
}

function attributesOf(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const body = tag.replace(/^<[^\s/>]+/, "").replace(/\/?>$/, "");
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

  for (const match of body.matchAll(pattern)) {
    const name = match[1]?.toLowerCase();
    if (name) attributes.set(name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return attributes;
}

function attributeValues(html: string, tagName: string, selector: string, attribute: string) {
  const values: string[] = [];
  for (const tag of tagsNamed(html, tagName)) {
    const attributes = attributesOf(tag);
    if (attributes.get("name")?.toLowerCase() !== selector) continue;
    const value = attributes.get(attribute);
    if (value !== undefined) values.push(value.trim());
  }
  return values;
}

/** Extract only the signals used by the corpus gate; this is not a browser DOM. */
export function inspectSeoHtml(html: string): SeoDocumentSignals {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1] ?? "";
  const titles = Array.from(head.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi), (match) =>
    normalizedText(match[1] ?? ""),
  );
  const canonicals: string[] = [];
  const links: string[] = [];

  for (const tag of tagsNamed(head, "link")) {
    const attributes = attributesOf(tag);
    const rel = attributes.get("rel")?.toLowerCase().split(/\s+/) ?? [];
    const href = attributes.get("href");
    if (rel.includes("canonical") && href !== undefined) canonicals.push(href.trim());
  }
  for (const tag of tagsNamed(html, "a")) {
    const href = attributesOf(tag).get("href");
    if (href !== undefined) links.push(href.trim());
  }

  return {
    titles,
    descriptions: attributeValues(head, "meta", "description", "content"),
    canonicals,
    robots: attributeValues(head, "meta", "robots", "content"),
    h1Count: tagsNamed(html, "h1").length,
    headingLevels: Array.from(html.matchAll(/<h([1-6])\b[^>]*>/gi), (match) => Number(match[1])),
    imagesWithoutAlt: tagsNamed(html, "img").filter((tag) => !attributesOf(tag).has("alt")).length,
    links,
  };
}

export function parseSitemapLocations(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/gi), (match) =>
    decodeEntities(match[1] ?? "").trim(),
  ).filter(Boolean);
}

export function validateSitemapLocations(locations: string[], expectedOrigin: string): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  if (locations.length === 0) return ["sitemap.xml contains no <loc> entries"];

  for (const location of locations) {
    let url: URL;
    try {
      url = new URL(location);
    } catch {
      issues.push(`sitemap has an invalid URL: ${location}`);
      continue;
    }

    if (seen.has(location)) issues.push(`sitemap repeats ${location}`);
    seen.add(location);
    if (url.origin !== expectedOrigin) {
      issues.push(`${location}: sitemap URL must use ${expectedOrigin}`);
    }
    if (url.search || url.hash)
      issues.push(`${location}: sitemap URL contains a query or fragment`);
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      issues.push(`${location}: sitemap URL has a trailing slash`);
    }
  }
  return issues;
}

function addUnique(
  values: Map<string, string>,
  value: string,
  location: string,
  label: string,
  issues: string[],
): void {
  const key = value.toLocaleLowerCase("en-US");
  const first = values.get(key);
  if (first) issues.push(`${location}: duplicate ${label} also used by ${first}`);
  else values.set(key, location);
}

function normalizedInternalLink(
  href: string,
  sourceLocation: string,
  expectedOrigin: string,
): string | undefined {
  try {
    const url = new URL(href, sourceLocation);
    if (url.origin !== expectedOrigin) return undefined;
    url.hash = "";
    url.search = "";
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href;
  } catch {
    return undefined;
  }
}

function validatePage(
  location: string,
  page: SeoPageSnapshot,
  issues: string[],
): SeoDocumentSignals {
  const signals = inspectSeoHtml(page.html);
  validateResponse(location, page, issues);
  validateRequiredSignals(location, signals, issues);
  validateCanonical(location, signals.canonicals, issues);
  validateIndexability(location, page, signals, issues);
  return signals;
}

interface CorpusValidationState {
  expectedOrigin: string;
  issues: string[];
  titles: Map<string, string>;
  descriptions: Map<string, string>;
  inbound: Map<string, Set<string>>;
}

function validateCorpusPage(
  location: string,
  page: SeoPageSnapshot,
  state: CorpusValidationState,
): void {
  const signals = validatePage(location, page, state.issues);
  const title = signals.titles.length === 1 ? signals.titles[0] : undefined;
  const description = signals.descriptions.length === 1 ? signals.descriptions[0] : undefined;
  if (title) addUnique(state.titles, title, location, "title", state.issues);
  if (description) {
    addUnique(state.descriptions, description, location, "meta description", state.issues);
  }

  for (const href of signals.links) {
    const target = normalizedInternalLink(href, location, state.expectedOrigin);
    if (target && target !== location) state.inbound.get(target)?.add(location);
  }
}

/** Validate the complete rendered, indexable corpus and return every violation. */
export function validateSeoCorpus(
  sitemapXml: string,
  pages: SeoPageSnapshot[],
  expectedOrigin: string,
): string[] {
  const locations = parseSitemapLocations(sitemapXml);
  const issues = validateSitemapLocations(locations, expectedOrigin);
  if (issues.length > 0) return issues;

  const pagesByLocation = indexSeoPages(pages, issues);
  const state: CorpusValidationState = {
    expectedOrigin,
    issues,
    titles: new Map(),
    descriptions: new Map(),
    inbound: new Map(locations.map((location) => [location, new Set<string>()])),
  };
  for (const location of locations) {
    const page = pagesByLocation.get(location);
    if (!page) {
      issues.push(`${location}: sitemap page was not fetched`);
      continue;
    }
    validateCorpusPage(location, page, state);
  }

  for (const location of locations) {
    if (state.inbound.get(location)?.size === 0) {
      issues.push(`${location}: no internal link from another sitemap page`);
    }
  }
  return issues;
}
