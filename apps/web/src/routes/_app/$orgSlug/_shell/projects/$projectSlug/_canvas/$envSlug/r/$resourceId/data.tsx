import { createFileRoute } from "@tanstack/react-router";

// A panel tab: the resource layout renders the panel and reads which tab
// this is (see ./layout.tsx). Nothing renders here.
export const Route = createFileRoute("/_app/$orgSlug/_shell/projects/$projectSlug/_canvas/$envSlug/r/$resourceId/data")({
  staticData: { view: ["data"] },
});
