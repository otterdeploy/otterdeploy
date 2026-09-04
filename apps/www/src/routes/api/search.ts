import { createFileRoute } from "@tanstack/react-router";
import { createFromSource } from "fumadocs-core/search/server";

import { source } from "@/lib/source";
import { withResponseHeaders } from "@/response-policy";

const server = createFromSource(source, {
  // https://docs.orama.com/docs/orama-js/supported-languages
  language: "english",
});

export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      // robots.txt saves crawl budget on the ordinary lower-case path. Keep a
      // response policy too: URL parsers may decode percent-encoded letters
      // such as `/%61pi/search`, which do not match a literal robots rule but
      // still reach this handler.
      GET: async ({ request }) =>
        withResponseHeaders(await server.GET(request), [["X-Robots-Tag", "noindex, nofollow"]]),
    },
  },
});
