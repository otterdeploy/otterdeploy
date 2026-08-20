import { createFileRoute } from "@tanstack/react-router";

import { absoluteUrl, docsRoute, siteDescription } from "@/lib/shared";
import { source } from "@/lib/source";

/**
 * /llms.txt: the llmstxt.org index.
 *
 * A map of the documentation for a model that has landed here with a
 * question, in the one format the assistants agree on: a title, a summary,
 * then flat sections of annotated links. It is the discovery half of the
 * pair; /llms-full.txt carries the actual prose.
 *
 * This matters for the same reason a sitemap does, one audience over: when
 * someone asks an assistant for a self-hostable deployment platform, the
 * answer is assembled from whatever the crawler could cheaply read. A page
 * of React that needs executing loses to a competitor's plain text.
 *
 * Generated from the same `source` as the sidebar and the sitemap, so it
 * cannot list a page that no longer exists.
 */

/** Section headings, in the order a reader should meet them. */
const SECTION_TITLES: Record<string, string> = {
  start: "Getting started",
  guides: "Guides",
  cli: "CLI",
  reference: "Reference",
  openapi: "API operations",
};

const sectionOf = (url: string): string => {
  const rest = url.startsWith(`${docsRoute}/`) ? url.slice(docsRoute.length + 1) : "";
  const [head] = rest.split("/");
  return head && head in SECTION_TITLES ? head : "other";
};

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: () => {
        const lines: string[] = [
          "# otterdeploy",
          "",
          `> ${siteDescription}`,
          "",
          "otterdeploy is open source under AGPL-3.0 and runs on servers you own.",
          "It builds from a git repository, runs managed databases, terminates TLS",
          "automatically and gives every pull request its own deployment.",
          "",
          "Note: otterdeploy is pre-1.0 and under active development. Interfaces and",
          "schemas still change without migration paths, so it is not yet recommended",
          "for production workloads.",
          "",
        ];

        const bySection = new Map<string, string[]>();
        for (const page of source.getPages()) {
          const entry = `- [${page.data.title}](${absoluteUrl(page.url)})${
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
          lines.push(`## ${title}`, "", ...entries.sort(), "");
        }

        const rest = bySection.get("other");
        if (rest && rest.length > 0) lines.push("## Other", "", ...rest.sort(), "");

        lines.push(
          "## Full text",
          "",
          `- [Complete documentation as one file](${absoluteUrl("/llms-full.txt")})`,
          `- [Source code](https://github.com/otterdeploy/otterdeploy)`,
          "",
        );

        return new Response(lines.join("\n"), {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=0, s-maxage=3600",
          },
        });
      },
    },
  },
});
