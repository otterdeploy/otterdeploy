import { createFileRoute } from "@tanstack/react-router";

// The project logs' Edge source. ./layout.tsx renders the page and reads
// which source this is. Nothing renders here.
export const Route = createFileRoute("/_app/$orgSlug/_shell/projects/$projectSlug/$envSlug/logs/edge")({
  staticData: { view: ["edge"] },
});
