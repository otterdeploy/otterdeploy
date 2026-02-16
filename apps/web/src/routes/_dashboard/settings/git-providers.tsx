import { createFileRoute } from "@tanstack/react-router";

import { GitProviderList } from "@/components/settings/git-provider-list";

export const Route = createFileRoute("/_dashboard/settings/git-providers")({
  component: GitProvidersPage,
});

function GitProvidersPage() {
  return <GitProviderList />;
}
