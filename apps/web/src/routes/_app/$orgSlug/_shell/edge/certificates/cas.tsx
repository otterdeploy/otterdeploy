import { createFileRoute } from "@tanstack/react-router";

// Edge › Caddy › Certificates › Trusted CAs. The edge layout (../layout.tsx) renders the page and reads which plane
// this is. Nothing renders here.
export const Route = createFileRoute("/_app/$orgSlug/_shell/edge/certificates/cas")({
  staticData: { view: ["caddy", "certs", "cas"] },
});
