import { createFileRoute } from "@tanstack/react-router";

// Edge › Caddy › Events. The edge layout (./layout.tsx) renders the page and reads which plane
// this is. Nothing renders here.
export const Route = createFileRoute("/_app/$orgSlug/_shell/edge/events")({
  staticData: { view: ["caddy", "events"] },
});
