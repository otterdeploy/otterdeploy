import { createFileRoute } from "@tanstack/react-router";

import { llmsIndexText } from "@/lib/llms";
import { machineReadableTextHeaders } from "@/lib/shared";
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
 * Generated from the authored docs source. Virtual OpenAPI operation pages
 * stay out for the same reason they are absent from the sitemap: the stable
 * overview is the useful discovery entry point, not hundreds of schema pages.
 */

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(llmsIndexText(source.getPages()), { headers: machineReadableTextHeaders }),
    },
  },
});
