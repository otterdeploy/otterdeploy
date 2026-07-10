/**
 * Shared bits for the Docker inventory tabs plus the swarm Tasks table. The
 * per-daemon tables live in sibling files: `docker-table-containers.tsx`,
 * `docker-table-images.tsx`, `docker-table-volumes.tsx`,
 * `docker-table-networks.tsx`.
 */
import { Button } from "@/shared/components/ui/button";
import { TableCell, TableRow } from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";

import { shortId, taskTone, timeAgoIso } from "./docker-format";
import { Panel, type QueryLike, StateBadge } from "./docker-panel";

/** Local row type — mirrors the docker contract output shape. */
interface Task {
  id: string;
  serviceId: string;
  slot: number | null;
  nodeId: string;
  desiredState: string;
  state: string;
  message: string | null;
  image: string | null;
  createdAt: string | null;
}

export function RowActionButton({
  label,
  onClick,
  disabled,
  title,
  destructive,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  destructive?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "h-6.5 px-2 text-xs text-muted-foreground hover:text-foreground",
        destructive && "hover:bg-destructive/10 hover:text-destructive",
      )}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

// ─── Swarm tasks ─────────────────────────────────────────────────────────────

export function TasksTable({
  query,
  nodeNames,
}: {
  query: QueryLike<Task>;
  /** Swarm node id → hostname, from docker.nodes.list. */
  nodeNames: Map<string, string>;
}) {
  return (
    <Panel
      query={query}
      headers={["Service", "Slot", "Image", "Node", "Desired", "State", "Age", "Message"]}
      emptyTitle="No tasks"
      emptyText="No swarm tasks. This daemon may not be a swarm manager."
    >
      {(rows) =>
        rows.map((t) => (
          <TableRow key={t.id}>
            <TableCell className="pl-4 font-mono text-xs font-medium">
              {shortId(t.serviceId)}
            </TableCell>
            <TableCell className="text-muted-foreground">{t.slot ?? "—"}</TableCell>
            <TableCell
              className="max-w-[220px] truncate font-mono text-xs text-muted-foreground"
              title={t.image ?? undefined}
            >
              {t.image ?? "—"}
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground" title={t.nodeId}>
              {nodeNames.get(t.nodeId) ?? shortId(t.nodeId)}
            </TableCell>
            <TableCell className="text-muted-foreground">{t.desiredState || "—"}</TableCell>
            <TableCell>
              <StateBadge state={t.state} tone={taskTone(t.state)} />
            </TableCell>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {timeAgoIso(t.createdAt)}
            </TableCell>
            <TableCell
              className={cn(
                "max-w-[220px] truncate pr-4",
                t.message ? "text-destructive" : "text-muted-foreground",
              )}
              title={t.message ?? undefined}
            >
              {t.message ?? "—"}
            </TableCell>
          </TableRow>
        ))
      }
    </Panel>
  );
}
