import { createFileRoute } from "@tanstack/react-router";

import { LandingNext } from "@/components/landing-next/landing-next";
import { seo } from "@/lib/seo";

/**
 * The next landing page, side by side with the current one while it's being
 * iterated on. Not indexed: `seo()` emits a permissive robots tag, so it is
 * swapped for a closed one here rather than added alongside (React dedupes
 * hoisted <meta> by name, and two would leave whichever it kept to chance).
 * Not in the sitemap either; sitemap.xml lists / and the docs only.
 */
export const Route = createFileRoute("/next")({
  head: () => ({
    meta: [
      ...seo({ path: "/next", title: "Landing preview" }).filter(
        (tag) => !("name" in tag && tag.name === "robots"),
      ),
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Next,
});

function Next() {
  return <LandingNext />;
}
