import { createFileRoute } from "@tanstack/react-router";

import { LandingNext } from "@/components/landing-next/landing-next";
import { canonical, organizationJsonLd, seo, softwareJsonLd } from "@/lib/seo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: seo({ path: "/" }),
    links: [canonical("/")],
    scripts: [
      { type: "application/ld+json", children: softwareJsonLd() },
      { type: "application/ld+json", children: organizationJsonLd() },
    ],
  }),
  component: Home,
});

// The marketing landing: the product-led page in components/landing-next.
function Home() {
  return <LandingNext />;
}
