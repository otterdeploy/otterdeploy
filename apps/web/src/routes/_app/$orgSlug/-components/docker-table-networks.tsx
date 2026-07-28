import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  SelectAllHead,
  SelectionBar,
  SelectRowCell,
  useTableSelection,
} from "@/shared/components/table-selection";
import { Badge } from "@/shared/components/ui/badge";
import { TableCell, TableRow } from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { DockerBulkRemoveDialog } from "./docker-bulk-remove";
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

const isBuiltin = (n: Network) => BUILTIN_NETWORKS.has(n.name) || n.ingress;

export function NetworksTable({ query }: { query: QueryLike<Network> }) {
  const [inspectFor, setInspectFor] = useState<Network | null>(null);
  const [removeFor, setRemoveFor] = useState<Network | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  // Built-in networks can never be removed — that's a Docker invariant, not a
  // racy ref-count — so select-all skips them rather than queueing guaranteed
  // failures. They stay individually selectable.
  const selection = useTableSelection(query.data ?? [], (n) => n.id, {
    bulkEligible: (n) => !isBuiltin(n),
  });

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
        leadingHead={<SelectAllHead selection={selection} />}
        emptyTitle="No networks"
        emptyText="No networks exist on this daemon."
      >
        {(rows) =>
          rows.map((n) => {
            const builtin = isBuiltin(n);
            return (
              <TableRow key={n.id}>
                <SelectRowCell selection={selection} row={n} label={n.name} />
                <TableCell
                  className="max-w-[180px] truncate font-mono text-xs font-medium"
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

      <SelectionBar
        selection={selection}
        nounKey="docker.noun.network"
        actionLabel="Remove"
        onAction={() => setBulkOpen(true)}
        pending={bulkOpen}
      />
      <DockerBulkRemoveDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        selection={selection}
        nounKey="docker.noun.network"
        labelOf={(n) => n.name}
        removeOne={(n) => orpc.docker.networks.remove.call({ id: n.id })}
        consequence="They'll be deleted from this daemon. Anything still referencing one by name will fail to start. Networks with containers still attached — and Docker's built-in networks — will be refused."
        onDone={() => query.refetch()}
      />
    </>
  );
}
