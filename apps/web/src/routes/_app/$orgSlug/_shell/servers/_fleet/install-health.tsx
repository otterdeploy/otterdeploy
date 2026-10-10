import { createFileRoute } from "@tanstack/react-router";

// Install health. The fleet layout (./layout.tsx) renders the page and reads which
// section this is. Nothing renders here.
export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/_fleet/install-health")({
  staticData: { view: ["install-health"] },
});
