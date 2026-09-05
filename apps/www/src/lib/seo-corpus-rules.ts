import type { SeoDocumentSignals, SeoPageSnapshot } from "./seo-corpus";

export function validateResponse(location: string, page: SeoPageSnapshot, issues: string[]): void {
  if (page.status !== 200) issues.push(`${location}: expected HTTP 200, received ${page.status}`);
  if (!page.contentType?.toLowerCase().includes("text/html")) {
    issues.push(`${location}: response is not HTML (${page.contentType ?? "no content-type"})`);
  }
}

export function validateRequiredSignals(
  location: string,
  signals: SeoDocumentSignals,
  issues: string[],
): void {
  if (signals.h1Count !== 1) issues.push(`${location}: expected one H1, found ${signals.h1Count}`);
  for (let index = 1; index < signals.headingLevels.length; index += 1) {
    const previous = signals.headingLevels[index - 1] ?? 1;
    const current = signals.headingLevels[index] ?? previous;
    if (current > previous + 1) {
      issues.push(`${location}: heading hierarchy jumps from H${previous} to H${current}`);
    }
  }
  if (signals.titles.length !== 1 || !signals.titles[0]) {
    issues.push(`${location}: expected one non-empty title, found ${signals.titles.length}`);
  }
  if (signals.descriptions.length !== 1 || !signals.descriptions[0]) {
    issues.push(
      `${location}: expected one non-empty meta description, found ${signals.descriptions.length}`,
    );
  }
}

export function validateCanonical(location: string, canonicals: string[], issues: string[]): void {
  if (canonicals.length !== 1) {
    issues.push(`${location}: expected one canonical, found ${canonicals.length}`);
    return;
  }

  try {
    const canonical = new URL(canonicals[0] ?? "", location);
    if (canonical.href !== location) {
      issues.push(`${location}: canonical points to ${canonical.href}`);
    }
    if (canonical.search || canonical.hash) {
      issues.push(`${location}: canonical contains a query or fragment`);
    }
  } catch {
    issues.push(`${location}: canonical is not a valid URL`);
  }
}

export function validateIndexability(
  location: string,
  page: SeoPageSnapshot,
  signals: SeoDocumentSignals,
  issues: string[],
): void {
  if (signals.imagesWithoutAlt > 0) {
    issues.push(`${location}: ${signals.imagesWithoutAlt} image(s) have no alt attribute`);
  }
  if ([...signals.robots, page.xRobotsTag ?? ""].some((value) => /\bnoindex\b/i.test(value))) {
    issues.push(`${location}: a sitemap page is marked noindex`);
  }
}

export function indexSeoPages(
  pages: SeoPageSnapshot[],
  issues: string[],
): Map<string, SeoPageSnapshot> {
  const indexed = new Map<string, SeoPageSnapshot>();
  for (const page of pages) {
    if (indexed.has(page.location)) issues.push(`duplicate response for ${page.location}`);
    indexed.set(page.location, page);
  }
  return indexed;
}
