import { createFileRoute } from "@tanstack/react-router";

import { absoluteUrl, machineReadableTextHeaders, siteDescription } from "@/lib/shared";
import { isIndexableDocsPage } from "@/lib/sitemap";
import { source } from "@/lib/source";

/**
 * /llms-full.txt: every documentation page as one plain-text file.
 *
 * The companion to /llms.txt. An assistant that has decided our docs are
 * relevant can take the whole corpus in one request instead of crawling
 * individual React routes and hoping each one rendered.
 *
 * Only authored MDX pages contribute. The OpenAPI operation pages come from a
 * build-time spec snapshot and carry no prose worth flattening, so they stay
 * out rather than appearing as hundreds of empty headings.
 */
export const Route = createFileRoute("/llms-full.txt")({
  server: {
    handlers: {
      GET: async () => {
        const parts: string[] = [
          "# otterdeploy documentation",
          "",
          siteDescription,
          "",
          "Source: https://github.com/otterdeploy/otterdeploy (AGPL-3.0)",
          "",
          "otterdeploy is pre-1.0 and under active development. Interfaces and schemas",
          "still change without migration paths.",
          "",
          "---",
          "",
        ];

        for (const page of source.getPages().filter(isIndexableDocsPage)) {
          const data = page.data;

          // `getText` is only present on MDX-backed pages (it comes from
          // `includeProcessedMarkdown` in source.config.ts). Checked at
          // runtime rather than asserted: the virtual OpenAPI pages share
          // this union and genuinely do not have it.
          if (!("getText" in data) || typeof data.getText !== "function") continue;

          const body = await data.getText("processed");

          parts.push(
            `# ${data.title}`,
            "",
            `URL: ${absoluteUrl(page.url)}`,
            ...(data.description ? [`Summary: ${data.description}`, ""] : [""]),
            body.trim(),
            "",
            "---",
            "",
          );
        }

        return new Response(parts.join("\n"), { headers: machineReadableTextHeaders });
      },
    },
  },
});
