import { createFileRoute } from "@tanstack/react-router";

// Webhooks › Inbound. ./layout.tsx renders the page and reads which tab
// this is. Nothing renders here.
export const Route = createFileRoute("/_app/$orgSlug/_settings/workspace/webhooks/inbound")({
  staticData: { view: ["inbound"] },
});
