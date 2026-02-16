import { createFileRoute } from "@tanstack/react-router";

import { DomainList } from "@/components/settings/domain-list";

export const Route = createFileRoute("/_dashboard/settings/domains")({
  component: DomainsPage,
});

function DomainsPage() {
  return <DomainList />;
}
