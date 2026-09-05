import { seoTitleOf } from "./seo";
import { absoluteUrl, docsRoute, siteDescription } from "./shared";
import { isIndexableDocsPage } from "./sitemap";

interface LlmsPageData {
  title?: string;
  seoTitle?: string;
  description?: string;
  _openapi?: unknown;
}

export interface LlmsPage {
  url: string;
  data: LlmsPageData;
}

/** Section headings, in the order a reader should meet them. */
const SECTION_TITLES: Record<string, string> = {
  overview: "Overview",
  start: "Getting started",
  guides: "Guides",
  cli: "CLI",
  reference: "Reference",
  openapi: "API operations",
};

function sectionOf(url: string): string {
  if (url === docsRoute) return "overview";

  const rest = url.startsWith(`${docsRoute}/`) ? url.slice(docsRoute.length + 1) : "";
  const [head] = rest.split("/");
  return head && head in SECTION_TITLES ? head : "other";
}

/** Build the compact llms.txt discovery index from authored documentation. */
export function llmsIndexText(pages: readonly LlmsPage[]): string {
  const lines: string[] = [
    "# otterdeploy",
    "",
    `> ${siteDescription}`,
    "",
    "otterdeploy is open source under AGPL-3.0 and runs on servers you own.",
    "It builds from a git repository, runs managed databases, terminates TLS",
    "automatically, and can create pull-request previews for opted-in services.",
    "",
    "Note: otterdeploy is pre-1.0 and under active development. Interfaces and",
    "schemas still change without migration paths, so it is not yet recommended",
    "for production workloads.",
    "",
  ];

  const bySection = new Map<string, string[]>([
    [
      "overview",
      [
        `- [otterdeploy home](${absoluteUrl("/")}): ${siteDescription}`,
        `- [Platform comparison](${absoluteUrl("/#compare")}): Compare self-hosting by hand and alternative deployment platforms.`,
        `- [Frequently asked questions](${absoluteUrl("/#faq")}): Straight answers about readiness, cost, requirements, orchestration, and recovery.`,
      ],
    ],
  ]);

  for (const page of pages.filter(isIndexableDocsPage)) {
    const title = page.data.title?.trim();
    if (!title) continue;

    const entry = `- [${seoTitleOf({ title, seoTitle: page.data.seoTitle })}](${absoluteUrl(page.url)})${
      page.data.description ? `: ${page.data.description}` : ""
    }`;
    const key = sectionOf(page.url);
    const bucket = bySection.get(key);
    if (bucket) bucket.push(entry);
    else bySection.set(key, [entry]);
  }

  for (const [key, title] of Object.entries(SECTION_TITLES)) {
    const entries = bySection.get(key);
    if (!entries || entries.length === 0) continue;
    lines.push(`## ${title}`, "", ...(key === "overview" ? entries : [...entries].sort()), "");
  }

  const rest = bySection.get("other");
  if (rest && rest.length > 0) lines.push("## Other", "", ...[...rest].sort(), "");

  lines.push(
    "## Full text",
    "",
    `- [Complete documentation as one file](${absoluteUrl("/llms-full.txt")})`,
    "- [Source code](https://github.com/otterdeploy/otterdeploy)",
    "",
  );

  return lines.join("\n");
}
