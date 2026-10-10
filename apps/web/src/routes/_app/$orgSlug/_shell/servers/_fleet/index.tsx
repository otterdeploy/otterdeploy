import { createFileRoute } from "@tanstack/react-router";

// Fleet overview. The fleet layout (./layout.tsx) renders the page and reads which
// section this is. Nothing renders here.
export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/_fleet/")({
  staticData: { view: ["overview"] },
});
