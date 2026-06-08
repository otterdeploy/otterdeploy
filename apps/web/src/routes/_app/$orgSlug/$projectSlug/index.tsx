import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The project root has no surface of its own — the graph IS the project
 * overview (live resource + pending-change nodes). The old Overview here
 * was 100% hardcoded mock data, so a freshly-created resource (and its
 * pending ghost) could never show up on the landing page. Redirect straight
 * to the graph so "open a project" always lands on the live canvas.
 */
export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/")({
  staticData: { crumb: "Overview" },
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$orgSlug/$projectSlug/graph",
      params: { orgSlug: params.orgSlug, projectSlug: params.projectSlug },
    });
  },
});
