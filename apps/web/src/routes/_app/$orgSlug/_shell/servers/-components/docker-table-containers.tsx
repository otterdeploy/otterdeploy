/**
 * The Raw Docker containers tab as an inspector table: a filter bar (text
 * search + state chips) over the ledger, status compressed to a dot + uptime
 * so the healthy majority reads quiet, hover-revealed Logs/Exec plus an
 * always-tappable ⋯ menu, and a row click that opens the inspector.
 * Operator-started strays (no platform label) carry an "unmanaged" marker:
 * on a raw-daemon view those are exactly what you came to find.
 */
import { useMemo, useState } from "react";

import { MoreHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";

import { encodeSessionToken } from "@/features/terminal/url";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { TableCell, TableRow } from "@/shared/components/ui/table";
import { orpc } from "@/shared/server/orpc";

import { ContainerLogsDialog, InspectDialog } from "./docker-dialogs";
import {
  compressContainerStatus,
  containerTone,
  shortId,
  timeAgoSeconds,
} from "./docker-format";
import { Panel, type QueryLike } from "./docker-panel";
import { StateBadge } from "./docker-state-badge";
import { RowActionButton } from "./docker-tables";
import {
  ContainersFilterBar,
  matchesSearch,
  matchesStateFilter,
  type Container,
  type StateFilter,
} from "./docker-containers-filter";

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

function ContainerRow({
  c,
  onLogs,
  onInspect,
}: {
  c: Container;
  onLogs: () => void;
  onInspect: () => void;
}) {
  const running = c.state.toLowerCase() === "running";
  return (
    <TableRow className="group cursor-pointer" onClick={onInspect}>
      <TableCell className="pl-4">
        <div className="max-w-[220px] truncate text-[13px] font-medium" title={c.name}>
          {c.name}
        </div>
        <div className="font-mono text-[10.5px] text-muted-foreground/70">{shortId(c.id)}</div>
      </TableCell>
      <TableCell
        className="max-w-[200px] truncate font-mono text-xs text-muted-foreground"
        title={c.image}
      >
        {c.image}
      </TableCell>
      <TableCell>
        <StateBadge
          state={c.state}
          // An unmanaged stray is worth a second look even while healthy:
          // downgrade its tone to warning so it reads as the exception.
          tone={c.managed ? containerTone(c.state, c.status) : "warning"}
          label={
            c.managed
              ? compressContainerStatus(c.state, c.status)
              : `${compressContainerStatus(c.state, c.status)} · unmanaged`
          }
          title={c.status}
        />
      </TableCell>
      <TableCell className="max-w-[140px] truncate font-mono text-xs text-muted-foreground">
        {c.ports.length > 0 ? c.ports.join(", ") : "–"}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {timeAgoSeconds(c.createdAt)}
      </TableCell>
      {/* stopPropagation: the row opens the inspector; the action cluster
          shouldn't. */}
      <TableCell className="pr-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-0.5">
          <span className="hidden gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 sm:flex">
            <RowActionButton label="Logs" onClick={onLogs} />
            <RowActionButton
              label="Exec"
              disabled={!running}
              title={running ? "Open a shell in this container" : "Only running containers can be exec'd"}
              onClick={() => execInto(c)}
            />
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${c.name}`}
                  className="text-muted-foreground"
                />
              }
            >
              <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onLogs}>Logs</DropdownMenuItem>
              <DropdownMenuItem onClick={onInspect}>Inspect</DropdownMenuItem>
              <DropdownMenuItem disabled={!running} onClick={() => execInto(c)}>
                Exec
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function ContainersTable({ query }: { query: QueryLike<Container> }) {
  const [logsFor, setLogsFor] = useState<Container | null>(null);
  const [inspectFor, setInspectFor] = useState<Container | null>(null);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>(null);

  const inspect = useQuery({
    ...orpc.docker.containers.inspect.queryOptions({
      input: { id: inspectFor?.id ?? "" },
    }),
    enabled: inspectFor !== null,
  });

  const all = useMemo(() => query.data ?? [], [query.data]);
  const needle = search.trim().toLowerCase();
  const filtered = useMemo(
    () => all.filter((c) => matchesStateFilter(c, stateFilter) && matchesSearch(c, needle)),
    [all, stateFilter, needle],
  );
  // Panel owns loading/error/empty/pagination; hand it the filtered view.
  const filteredQuery: QueryLike<Container> = {
    ...query,
    data: query.data === undefined ? undefined : filtered,
  };

  return (
    <>
      {all.length > 0 && (
        <ContainersFilterBar
          all={all}
          query={search}
          onQuery={setSearch}
          filter={stateFilter}
          onFilter={setStateFilter}
        />
      )}

      {all.length > 0 && filtered.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/20 py-10 text-center text-[13px] text-muted-foreground">
          No containers match the current filters.
        </div>
      ) : (
        <Panel
          query={filteredQuery}
          headers={["Name", "Image", "Status", "Ports", "Created", ""]}
          emptyTitle="No containers"
          emptyText="The daemon reported no containers."
        >
          {(rows) =>
            rows.map((c) => (
              <ContainerRow
                key={c.id}
                c={c}
                onLogs={() => setLogsFor(c)}
                onInspect={() => setInspectFor(c)}
              />
            ))
          }
        </Panel>
      )}

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
