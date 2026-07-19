import { useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { encodeSessionToken } from "@/features/terminal/url";
import { TableCell, TableRow } from "@/shared/components/ui/table";
import { orpc } from "@/shared/server/orpc";

import { ContainerLogsDialog, InspectDialog } from "./docker-dialogs";
import { containerTone, shortId, timeAgoSeconds } from "./docker-format";
import { Panel, type QueryLike, StateBadge } from "./docker-panel";
import { RowActionButton } from "./docker-tables";

/** Local row type — mirrors the docker contract output shape. */
interface Container {
  id: string;
  name: string;
  image: string;
  command: string;
  state: string;
  status: string;
  ports: string[];
  createdAt: number;
}

// Deep-link into the popout terminal targeting this container. The /pty
// exec path only needs the container id; the other token fields label the
// session tab.
function execInto(c: Container) {
  const token = encodeSessionToken({
    kind: "container",
    project: "docker",
    service: c.name,
    replica: shortId(c.id),
    containerId: c.id,
  });
  const params = new URLSearchParams();
  params.append("session", token);
  window.open(`/terminal?${params.toString()}`, "_blank", "noopener");
}

export function ContainersTable({ query }: { query: QueryLike<Container> }) {
  const [logsFor, setLogsFor] = useState<Container | null>(null);
  const [inspectFor, setInspectFor] = useState<Container | null>(null);

  const inspect = useQuery({
    ...orpc.docker.containers.inspect.queryOptions({
      input: { id: inspectFor?.id ?? "" },
    }),
    enabled: inspectFor !== null,
  });

  return (
    <>
      <Panel
        query={query}
        headers={["ID", "Name", "Image", "Command", "Status", "Ports", "Created", ""]}
        emptyTitle="No containers"
        emptyText="The daemon reported no containers."
      >
        {(rows) =>
          rows.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="pl-4 font-mono text-xs text-muted-foreground">
                {shortId(c.id)}
              </TableCell>
              <TableCell className="max-w-[180px] truncate font-medium" title={c.name}>
                {c.name}
              </TableCell>
              <TableCell
                className="max-w-[200px] truncate font-mono text-xs text-muted-foreground"
                title={c.image}
              >
                {c.image}
              </TableCell>
              <TableCell
                className="max-w-[160px] truncate font-mono text-xs text-muted-foreground"
                title={c.command}
              >
                {c.command || "—"}
              </TableCell>
              <TableCell>
                <StateBadge
                  state={c.state}
                  tone={containerTone(c.state, c.status)}
                  label={c.status}
                  title={c.state}
                />
              </TableCell>
              <TableCell className="max-w-[140px] truncate font-mono text-xs text-muted-foreground">
                {c.ports.length > 0 ? c.ports.join(", ") : "—"}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {timeAgoSeconds(c.createdAt)}
              </TableCell>
              <TableCell className="pr-4">
                <div className="flex items-center justify-end gap-0.5">
                  <RowActionButton label="Logs" onClick={() => setLogsFor(c)} />
                  <RowActionButton label="Inspect" onClick={() => setInspectFor(c)} />
                  <RowActionButton
                    label="Exec"
                    disabled={c.state.toLowerCase() !== "running"}
                    title={
                      c.state.toLowerCase() === "running"
                        ? "Open a shell in this container"
                        : "Only running containers can be exec'd"
                    }
                    onClick={() => execInto(c)}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))
        }
      </Panel>

      <ContainerLogsDialog
        open={logsFor !== null}
        onOpenChange={(v) => !v && setLogsFor(null)}
        container={logsFor}
      />
      <InspectDialog
        open={inspectFor !== null}
        onOpenChange={(v) => !v && setInspectFor(null)}
        title="Inspect container"
        subtitle={inspectFor ? `${inspectFor.name} · ${shortId(inspectFor.id)}` : ""}
        query={inspect}
      />
    </>
  );
}
