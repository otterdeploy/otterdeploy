import { createFileRoute } from "@tanstack/react-router";

import { ReadmeLanding } from "@/components/landing/readme-landing";

export const Route = createFileRoute("/")({
  component: Home,
});

// Better-Auth-style split-screen README landing: a fixed left brand panel and a
// right column that scrolls like a project README. Light-first; the theme
// toggle re-scopes the shared design tokens. See readme-landing.tsx.
function Home() {
  return <ReadmeLanding />;
}
