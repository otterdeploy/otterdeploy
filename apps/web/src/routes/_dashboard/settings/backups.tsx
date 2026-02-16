import { createFileRoute } from "@tanstack/react-router";

import { BackupList } from "@/components/settings/backup-list";

export const Route = createFileRoute("/_dashboard/settings/backups")({
  component: BackupsPage,
});

function BackupsPage() {
  return <BackupList />;
}
