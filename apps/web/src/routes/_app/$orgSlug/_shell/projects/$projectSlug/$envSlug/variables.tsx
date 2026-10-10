import { createFileRoute } from "@tanstack/react-router";

import { envCollection } from "@/features/projects/data/env";

import { VariablesPage } from "../-components/variables-page";

// One environment's variables: the matching tab of the Variables page.
export const Route = createFileRoute("/_app/$orgSlug/_shell/projects/$projectSlug/$envSlug/variables")({
  staticData: { crumb: "Variables" },
  component: RouteComponent,
  loader: () => {
    void envCollection.preload();
  },
});

function RouteComponent() {
  const { envSlug } = Route.useParams();
  return <VariablesPage envSlug={envSlug} />;
}
