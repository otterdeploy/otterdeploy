import { createFileRoute } from "@tanstack/react-router";

// An Analytics view. ./layout.tsx renders the page and reads which view this
// is. Nothing renders here.
export const Route = createFileRoute("/_app/$orgSlug/_shell/monitoring/analytics/events")({
  staticData: { view: ["events"] },
});
