import { createFileRoute } from "@tanstack/react-router";

import { HERO_SHOTS } from "@/components/landing-next/content";
import { LandingNext } from "@/components/landing-next/landing-next";
import { HERO_SCREENSHOT_SIZES, screenshotWebpSrcSet } from "@/components/landing-next/window";
import { canonical, organizationJsonLd, seo, softwareJsonLd, websiteJsonLd } from "@/lib/seo";

const heroScreenshotSrc = HERO_SHOTS[0]?.img ?? "/landing/app-data-query.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: seo({ path: "/" }),
    links: [
      canonical("/"),
      {
        rel: "preload",
        as: "image",
        type: "image/webp",
        href: heroScreenshotSrc.replace(/\.png$/, "-800.webp"),
        imageSrcSet: screenshotWebpSrcSet(heroScreenshotSrc),
        imageSizes: HERO_SCREENSHOT_SIZES,
        fetchPriority: "high",
      },
    ],
    scripts: [
      { type: "application/ld+json", children: softwareJsonLd() },
      { type: "application/ld+json", children: organizationJsonLd() },
      { type: "application/ld+json", children: websiteJsonLd() },
    ],
  }),
  component: Home,
});

// The marketing landing: the product-led page in components/landing-next.
function Home() {
  return <LandingNext />;
}
