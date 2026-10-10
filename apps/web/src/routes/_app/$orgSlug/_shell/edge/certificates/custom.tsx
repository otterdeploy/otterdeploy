import { createFileRoute } from "@tanstack/react-router";

// Edge › Caddy › Certificates › Custom. The edge layout (../layout.tsx) renders the page and reads which plane
// this is. Nothing renders here.
export const Route = createFileRoute("/_app/$orgSlug/_shell/edge/certificates/custom")({
  staticData: { view: ["caddy", "certs", "custom"] },
});
