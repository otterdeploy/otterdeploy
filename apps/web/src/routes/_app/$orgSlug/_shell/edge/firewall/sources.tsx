import { createFileRoute } from "@tanstack/react-router";

// Edge › Firewall › Sources. The edge layout (../layout.tsx) renders the page and reads which plane
// this is. Nothing renders here.
export const Route = createFileRoute("/_app/$orgSlug/_shell/edge/firewall/sources")({
  staticData: { view: ["firewall", "sources"] },
});
