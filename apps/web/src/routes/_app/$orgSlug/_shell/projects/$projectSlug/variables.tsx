import { createFileRoute } from "@tanstack/react-router";

import { envCollection } from "@/features/projects/data/env";

import { VariablesPage } from "./-components/variables-page";

// The cross-environment matrix (the Variables "Overview" tab). Each
// environment's own table is `/$envSlug/variables`.
export const Route = createFileRoute("/_app/$orgSlug/_shell/projects/$projectSlug/variables")({
  staticData: { crumb: "Variables" },
  component: () => <VariablesPage />,
  // Warm the eager env collection on hover (intent-preload). The per-env
  // `variablesCollection` is on-demand, so preload() would be a no-op there.
  loader: () => {
    void envCollection.preload();
  },
});
