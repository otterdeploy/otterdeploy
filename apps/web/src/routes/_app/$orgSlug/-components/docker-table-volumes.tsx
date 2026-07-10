import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/shared/components/ui/badge";
import { TableCell, TableRow } from "@/shared/components/ui/table";
import { orpc } from "@/shared/server/orpc";

import { ConfirmRemoveDialog, InspectDialog } from "./docker-dialogs";
import { formatBytes, timeAgoSeconds } from "./docker-format";
import { Panel, type QueryLike } from "./docker-panel";
import { RowActionButton } from "./docker-tables";

/** Local row type — mirrors the docker contract output shape. */
interface Volume {
  name: string;
  driver: string;
  mountpoint: string;
  scope: string;
  createdAt: number | null;
  size: number;
  refCount: number;
}

export function VolumesTable({ query }: { query: QueryLike<Volume> }) {
  const [inspectFor, setInspectFor] = useState<Volume | null>(null);
  const [removeFor, setRemoveFor] = useState<Volume | null>(null);

  const inspect = useQuery({
    ...orpc.docker.volumes.inspect.queryOptions({ input: { name: inspectFor?.name ?? "" } }),
    enabled: inspectFor !== null,
  });

  const remove = useMutation(
    orpc.docker.volumes.remove.mutationOptions({
      onSuccess: () => {
        toast.success("Volume removed");
        setRemoveFor(null);
        query.refetch();
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  return (
    <>
      <Panel
        query={query}
        headers={["Name", "Driver", "Mountpoint", "Size", "In use", "Created", ""]}
        emptyTitle="No volumes"
        emptyText="No volumes exist on this daemon."
      >
        {(rows) =>
          rows.map((v) => (
            <TableRow key={v.name}>
              <TableCell
                className="max-w-[220px] truncate pl-4 font-mono text-xs font-medium"
                title={v.name}
              >
                {v.name}
              </TableCell>
              <TableCell className="text-muted-foreground">{v.driver}</TableCell>
              <TableCell
                className="max-w-[280px] truncate font-mono text-xs text-muted-foreground"
                title={v.mountpoint}
              >
                {v.mountpoint}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatBytes(v.size)}
              </TableCell>
              <TableCell>
                {v.refCount < 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : v.refCount > 0 ? (
                  <Badge variant="secondary" className="bg-success/10 text-success">
                    {v.refCount}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="bg-warning/10 text-warning">
                    orphan
                  </Badge>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {v.createdAt != null ? timeAgoSeconds(v.createdAt) : "—"}
              </TableCell>
              <TableCell className="pr-4">
                <div className="flex items-center justify-end gap-0.5">
                  <RowActionButton label="Inspect" onClick={() => setInspectFor(v)} />
                  <RowActionButton
                    label="Remove"
                    destructive
                    disabled={v.refCount > 0}
                    title={
                      v.refCount > 0
                        ? `Mounted by ${v.refCount} container${v.refCount === 1 ? "" : "s"}`
                        : undefined
                    }
                    onClick={() => setRemoveFor(v)}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))
        }
      </Panel>

      <InspectDialog
        open={inspectFor !== null}
        onOpenChange={(v) => !v && setInspectFor(null)}
        title="Inspect volume"
        subtitle={inspectFor?.name ?? ""}
        query={inspect}
      />
      <ConfirmRemoveDialog
        open={removeFor !== null}
        onOpenChange={(v) => !v && setRemoveFor(null)}
        title="Remove this volume?"
        description={
          <>
            All data in <span className="font-mono">{removeFor?.name}</span>
            {removeFor && removeFor.size > 0 ? ` (${formatBytes(removeFor.size)})` : ""} will be
            permanently deleted. This cannot be undone — the removal is refused if any container
            still mounts it.
          </>
        }
        confirmLabel="Remove volume"
        pending={remove.isPending}
        onConfirm={() => {
          if (removeFor) remove.mutate({ name: removeFor.name });
        }}
      />
    </>
  );
}
