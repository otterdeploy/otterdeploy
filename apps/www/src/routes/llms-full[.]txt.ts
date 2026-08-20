import { createFileRoute } from "@tanstack/react-router";

import { absoluteUrl, siteDescription } from "@/lib/shared";
import { source } from "@/lib/source";

/**
 * /llms-full.txt: every documentation page as one plain-text file.
 *
 * The companion to /llms.txt. An assistant that has decided our docs are
 * relevant can take the whole corpus in one request instead of crawling
 * fifteen React routes and hoping each one rendered.
 *
 * Only MDX pages contribute. The OpenAPI operation pages are generated at
 * runtime from the spec and carry no prose worth flattening, so they are
 * skipped rather than emitted as empty headings.
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

        for (const page of source.getPages()) {
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

        return new Response(parts.join("\n"), {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=0, s-maxage=3600",
          },
        });
      },
    },
  },
});
