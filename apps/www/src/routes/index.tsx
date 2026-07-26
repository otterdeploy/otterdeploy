import { createFileRoute } from "@tanstack/react-router";

import { Landing } from "@/components/landing/landing";
import { canonical, seo, softwareJsonLd } from "@/lib/seo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: seo({ path: "/" }),
    links: [canonical("/")],
    scripts: [{ type: "application/ld+json", children: softwareJsonLd() }],
  }),
  component: Home,
});

// The marketing landing page. Composition, fold order, and the reasoning
// behind both live in components/landing/landing.tsx.
function Home() {
  return <Landing />;
}
