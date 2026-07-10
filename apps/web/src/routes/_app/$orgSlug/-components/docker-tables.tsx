import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { encodeSessionToken } from "@/features/terminal/url";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { TableCell, TableRow } from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { ConfirmRemoveDialog, ContainerLogsDialog, InspectDialog } from "./docker-dialogs";
import {
  containerTone,
  formatBytes,
  shortId,
  splitRef,
  taskTone,
  timeAgoIso,
  timeAgoSeconds,
} from "./docker-format";
import { Panel, type QueryLike, StateBadge } from "./docker-panel";

/** Local row types — mirror the docker contract output shapes. */
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
interface Image {
  id: string;
  repoTags: string[];
  size: number;
  createdAt: number;
  containers: number;
}
interface Volume {
  name: string;
  driver: string;
  mountpoint: string;
  scope: string;
  createdAt: number | null;
  size: number;
  refCount: number;
}
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

function RowActionButton({
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

// ─── Containers ──────────────────────────────────────────────────────────────

export function ContainersTable({ query }: { query: QueryLike<Container> }) {
  const [logsFor, setLogsFor] = useState<Container | null>(null);
  const [inspectFor, setInspectFor] = useState<Container | null>(null);

  const inspect = useQuery({
    ...orpc.docker.containers.inspect.queryOptions({
      input: { id: inspectFor?.id ?? "" },
    }),
    enabled: inspectFor !== null,
  });

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

// ─── Images ──────────────────────────────────────────────────────────────────

export function ImagesTable({ query }: { query: QueryLike<Image> }) {
  const [inspectFor, setInspectFor] = useState<Image | null>(null);
  const [removeFor, setRemoveFor] = useState<Image | null>(null);

  const inspect = useQuery({
    ...orpc.docker.images.inspect.queryOptions({ input: { id: inspectFor?.id ?? "" } }),
    enabled: inspectFor !== null,
  });

  const remove = useMutation(
    orpc.docker.images.remove.mutationOptions({
      onSuccess: (res) => {
        toast.success(
          res.deleted > 0
            ? `Image removed (${res.deleted} layer${res.deleted === 1 ? "" : "s"} deleted)`
            : "Image untagged",
        );
        setRemoveFor(null);
        query.refetch();
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  const removeRef = removeFor ? (splitRef(removeFor.repoTags[0] ?? "").repo ?? "") : "";

  return (
    <>
      <Panel
        query={query}
        headers={["Repository", "Tag", "Image ID", "Size", "In use", "Created", ""]}
        emptyTitle="No images"
        emptyText="No images are cached on this daemon."
      >
        {(rows) =>
          rows.map((img) => {
            const { repo, tag } = splitRef(img.repoTags[0] ?? "<none>:<none>");
            const inUse = img.containers > 0;
            return (
              <TableRow key={img.id}>
                <TableCell
                  className={cn(
                    "max-w-[260px] truncate pl-4 font-mono text-xs",
                    repo === "<none>" ? "text-muted-foreground" : "font-medium",
                  )}
                  title={repo}
                >
                  {repo}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {tag || "—"}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {shortId(img.id)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatBytes(img.size)}
                </TableCell>
                <TableCell>
                  {img.containers < 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : inUse ? (
                    <Badge variant="secondary" className="bg-success/10 text-success">
                      {img.containers}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">unused</Badge>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {timeAgoSeconds(img.createdAt)}
                </TableCell>
                <TableCell className="pr-4">
                  <div className="flex items-center justify-end gap-0.5">
                    <RowActionButton label="Inspect" onClick={() => setInspectFor(img)} />
                    <RowActionButton
                      label="Remove"
                      destructive
                      disabled={inUse}
                      title={
                        inUse
                          ? `In use by ${img.containers} container${img.containers === 1 ? "" : "s"}`
                          : undefined
                      }
                      onClick={() => setRemoveFor(img)}
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
        title="Inspect image"
        subtitle={
          inspectFor
            ? `${splitRef(inspectFor.repoTags[0] ?? "<none>").repo} · ${shortId(inspectFor.id)}`
            : ""
        }
        query={inspect}
      />
      <ConfirmRemoveDialog
        open={removeFor !== null}
        onOpenChange={(v) => !v && setRemoveFor(null)}
        title="Remove this image?"
        description={
          <>
            <span className="font-mono">{removeRef || shortId(removeFor?.id ?? "")}</span> will be
            deleted from this daemon&apos;s cache
            {removeFor ? ` (${formatBytes(removeFor.size)} reclaimed)` : ""}. The next deploy that
            needs it will pull or rebuild it from scratch.
          </>
        }
        confirmLabel="Remove image"
        pending={remove.isPending}
        onConfirm={() => {
          if (removeFor) remove.mutate({ id: removeFor.id });
        }}
      />
    </>
  );
}

// ─── Volumes ─────────────────────────────────────────────────────────────────

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

// ─── Networks ────────────────────────────────────────────────────────────────

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
