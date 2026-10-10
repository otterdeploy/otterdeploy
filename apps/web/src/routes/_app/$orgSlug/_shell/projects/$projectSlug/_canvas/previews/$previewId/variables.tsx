import { createFileRoute } from "@tanstack/react-router";

// A preview panel tab: ./layout.tsx renders the panel and reads which tab
// this is. Nothing renders here.
export const Route = createFileRoute("/_app/$orgSlug/_shell/projects/$projectSlug/_canvas/previews/$previewId/variables")({
  staticData: { view: ["variables"] },
});
