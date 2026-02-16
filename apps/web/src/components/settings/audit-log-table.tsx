import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@otterstack/ui/components/ui/badge";
import { Button } from "@otterstack/ui/components/ui/button";
import { Input } from "@otterstack/ui/components/ui/input";
import { Skeleton } from "@otterstack/ui/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@otterstack/ui/components/ui/table";

import { getOrganizationId, orpc } from "@/utils/orpc";

export function AuditLogTable() {
  const organizationId = getOrganizationId() ?? "";
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("");

  const auditQuery = useQuery(
    orpc.audit.list.queryOptions({
      input: {
        organizationId,
        page,
        pageSize: 20,
        ...(actionFilter ? { action: actionFilter } : {}),
      },
      enabled: !!organizationId,
    }),
  );

  return (
    <div className="space-y-6 p-6">
      <div>
        <h3 className="text-lg font-semibold">Audit Log</h3>
        <p className="text-sm text-muted-foreground">Review organization activity and changes.</p>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Filter by action..."
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(1);
          }}
          className="max-w-xs"
        />
      </div>

      {auditQuery.isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded-lg" />
          ))}
        </div>
      )}

      {auditQuery.data && auditQuery.data.items.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No audit log entries found.</p>
        </div>
      )}

      {auditQuery.data && auditQuery.data.items.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Entity Type</TableHead>
                <TableHead>Entity ID</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>IP Address</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditQuery.data.items.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <Badge variant="outline">{entry.action}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{entry.entityType}</TableCell>
                  <TableCell className="font-mono text-xs">{entry.entityId ?? "N/A"}</TableCell>
                  <TableCell className="font-mono text-xs">{entry.actorUserId ?? "System"}</TableCell>
                  <TableCell className="font-mono text-xs">{entry.ipAddress ?? "N/A"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {auditQuery.data.meta.pagination.pageCount > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {auditQuery.data.meta.pagination.page} of {auditQuery.data.meta.pagination.pageCount} ({auditQuery.data.meta.pagination.total} total)
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= auditQuery.data.meta.pagination.pageCount} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
