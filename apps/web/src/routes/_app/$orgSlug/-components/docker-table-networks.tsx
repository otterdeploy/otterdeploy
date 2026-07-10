import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/shared/components/ui/badge";
import { TableCell, TableRow } from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { ConfirmRemoveDialog, InspectDialog } from "./docker-dialogs";
import { shortId, timeAgoSeconds } from "./docker-format";
import { Panel, type QueryLike } from "./docker-panel";
import { RowActionButton } from "./docker-tables";

/** Local row type — mirrors the docker contract output shape. */
interface Network {
  id: string;
  name: string;
  driver: string;
  scope: string;
  createdAt: number;
  internal: boolean;
  attachable: boolean;
  ingress: boolean;
  subnet: string | null;
  gateway: string | null;
  containers: number;
}

const BUILTIN_NETWORKS = new Set(["bridge", "host", "none", "ingress", "docker_gwbridge"]);

export function NetworksTable({ query }: { query: QueryLike<Network> }) {
  const [inspectFor, setInspectFor] = useState<Network | null>(null);
  const [removeFor, setRemoveFor] = useState<Network | null>(null);

  const inspect = useQuery({
    ...orpc.docker.networks.inspect.queryOptions({ input: { id: inspectFor?.id ?? "" } }),
    enabled: inspectFor !== null,
  });

  const remove = useMutation(
    orpc.docker.networks.remove.mutationOptions({
      onSuccess: () => {
        toast.success("Network removed");
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
        headers={["Name", "Driver", "Scope", "Subnet", "Gateway", "Attached", "Created", ""]}
        emptyTitle="No networks"
        emptyText="No networks exist on this daemon."
      >
        {(rows) =>
          rows.map((n) => {
            const builtin = BUILTIN_NETWORKS.has(n.name) || n.ingress;
            return (
              <TableRow key={n.id}>
                <TableCell
                  className="max-w-[180px] truncate pl-4 font-mono text-xs font-medium"
                  title={n.name}
                >
                  {n.name}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="secondary"
                    className={cn(n.driver === "overlay" && "bg-info/10 text-info")}
                  >
                    {n.driver}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{n.scope}</TableCell>
                <TableCell className="font-mono text-xs">{n.subnet ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {n.gateway ?? "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">{n.containers}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {timeAgoSeconds(n.createdAt)}
                </TableCell>
                <TableCell className="pr-4">
                  <div className="flex items-center justify-end gap-0.5">
                    <RowActionButton label="Inspect" onClick={() => setInspectFor(n)} />
                    <RowActionButton
                      label="Remove"
                      destructive
                      disabled={builtin}
                      title={builtin ? "Builtin Docker networks can't be removed" : undefined}
                      onClick={() => setRemoveFor(n)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            );
          })
        }
      </Panel>

      <InspectDialog
        open={inspectFor !== null}
        onOpenChange={(v) => !v && setInspectFor(null)}
        title="Inspect network"
        subtitle={inspectFor ? `${inspectFor.name} · ${shortId(inspectFor.id)}` : ""}
        query={inspect}
      />
      <ConfirmRemoveDialog
        open={removeFor !== null}
        onOpenChange={(v) => !v && setRemoveFor(null)}
        title="Remove this network?"
        description={
          <>
            <span className="font-mono">{removeFor?.name}</span> will be deleted. Containers can no
            longer be attached to it; anything still referencing it by name will fail to start. The
            removal is refused while containers are attached.
          </>
        }
        confirmLabel="Remove network"
        pending={remove.isPending}
        onConfirm={() => {
          if (removeFor) remove.mutate({ id: removeFor.id });
        }}
      />
    </>
  );
}
