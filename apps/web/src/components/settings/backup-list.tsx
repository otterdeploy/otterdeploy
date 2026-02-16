import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon, ArrowTurnBackwardIcon } from "@hugeicons/core-free-icons";
import { Badge } from "@otterstack/ui/components/ui/badge";
import { Button } from "@otterstack/ui/components/ui/button";
import { Skeleton } from "@otterstack/ui/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@otterstack/ui/components/ui/table";
import { toast } from "sonner";

import { getOrganizationId, orpc } from "@/utils/orpc";
import { toUserMessage } from "@/lib/result";

export function BackupList() {
  const organizationId = getOrganizationId() ?? "";
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const backupsQuery = useQuery(
    orpc.backup.list.queryOptions({
      input: { organizationId, page, pageSize: 10 },
      enabled: !!organizationId,
    }),
  );

  const deleteMutation = useMutation(orpc.backup.delete.mutationOptions());
  const restoreMutation = useMutation(orpc.backup.restore.mutationOptions());

  async function handleDelete(backupId: string) {
    try {
      await deleteMutation.mutateAsync({ backupId });
      await queryClient.invalidateQueries({ queryKey: orpc.backup.list.key() });
      toast.success("Backup deleted");
    } catch (error) {
      toast.error(toUserMessage(error, "Failed to delete backup"));
    }
  }

  async function handleRestore(backupId: string, resourceId: string) {
    try {
      await restoreMutation.mutateAsync({ backupId, targetResourceId: resourceId });
      toast.success("Restore initiated");
    } catch (error) {
      toast.error(toUserMessage(error, "Failed to restore backup"));
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h3 className="text-lg font-semibold">Backups</h3>
        <p className="text-sm text-muted-foreground">View and manage resource backups.</p>
      </div>

      {backupsQuery.isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      )}

      {backupsQuery.data && backupsQuery.data.items.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No backups found.</p>
        </div>
      )}

      {backupsQuery.data && backupsQuery.data.items.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backupsQuery.data.items.map((backup) => (
                <TableRow key={backup.id}>
                  <TableCell>
                    <Badge variant="outline">{backup.type}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={backup.status === "completed" ? "default" : "secondary"}>
                      {backup.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {backup.sizeBytes != null ? `${(backup.sizeBytes / 1024 / 1024).toFixed(1)} MB` : "N/A"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(backup.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => handleRestore(backup.id, backup.resourceId)} disabled={restoreMutation.isPending}>
                        <HugeiconsIcon icon={ArrowTurnBackwardIcon} strokeWidth={2} className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(backup.id)} disabled={deleteMutation.isPending}>
                        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {backupsQuery.data.meta.pagination.pageCount > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {backupsQuery.data.meta.pagination.page} of {backupsQuery.data.meta.pagination.pageCount}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= backupsQuery.data.meta.pagination.pageCount} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
