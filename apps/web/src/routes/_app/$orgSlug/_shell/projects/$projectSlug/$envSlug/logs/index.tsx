import { createFileRoute } from "@tanstack/react-router";

// The project logs' Runtime source. ./layout.tsx renders the page and reads
// which source this is. Nothing renders here.
export const Route = createFileRoute("/_app/$orgSlug/_shell/projects/$projectSlug/$envSlug/logs/")({
  staticData: { view: [] },
});
