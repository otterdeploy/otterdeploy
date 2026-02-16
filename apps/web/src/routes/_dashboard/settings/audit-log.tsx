import { createFileRoute } from "@tanstack/react-router";

import { AuditLogTable } from "@/components/settings/audit-log-table";

export const Route = createFileRoute("/_dashboard/settings/audit-log")({
  component: AuditLogPage,
});

function AuditLogPage() {
  return <AuditLogTable />;
}
