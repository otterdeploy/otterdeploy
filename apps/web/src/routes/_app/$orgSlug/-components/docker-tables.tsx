import { Badge } from "@/shared/components/ui/badge";
import { TableCell, TableRow } from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";

import {
  formatBytes,
  shortId,
  splitRef,
  timeAgoSeconds,
} from "./docker-format";
import { Panel, type QueryLike, StateBadge } from "./docker-panel";

/** Local row types — mirror the docker contract output shapes. */
interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
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
  createdAt: string | null;
}

export function ContainersTable({ query }: { query: QueryLike<Container> }) {
  return (
    <Panel
      query={query}
      headers={["Name", "Image", "State", "Status", "Created"]}
      emptyTitle="No containers"
      emptyText="The daemon reported no containers."
    >
      {(rows) =>
        rows.map((c) => (
          <TableRow key={c.id}>
            <TableCell className="pl-4 font-medium">{c.name}</TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">
              {c.image}
            </TableCell>
            <TableCell>
              <StateBadge state={c.state} />
            </TableCell>
            <TableCell className="text-muted-foreground">{c.status}</TableCell>
            <TableCell className="pr-4 text-muted-foreground">
              {timeAgoSeconds(c.createdAt)}
            </TableCell>
          </TableRow>
        ))
      }
    </Panel>
  );
}

export function ImagesTable({ query }: { query: QueryLike<Image> }) {
  return (
    <Panel
      query={query}
      headers={["Repository", "Tag", "Image ID", "Size", "In use", "Created"]}
      emptyTitle="No images"
      emptyText="No images are cached on this daemon."
    >
      {(rows) =>
        rows.map((img) => {
          const { repo, tag } = splitRef(img.repoTags[0] ?? "<none>:<none>");
          return (
            <TableRow key={img.id}>
              <TableCell className="pl-4 font-mono text-xs font-medium">
                {repo}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {tag || "—"}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {shortId(img.id)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatBytes(img.size)}
              </TableCell>
              <TableCell>
                {img.containers > 0 ? (
                  <Badge variant="default">{img.containers}</Badge>
                ) : (
                  <Badge variant="secondary">unused</Badge>
                )}
              </TableCell>
              <TableCell className="pr-4 text-muted-foreground">
                {timeAgoSeconds(img.createdAt)}
              </TableCell>
            </TableRow>
          );
        })
      }
    </Panel>
  );
}

export function VolumesTable({ query }: { query: QueryLike<Volume> }) {
  return (
    <Panel
      query={query}
      headers={["Name", "Driver", "Mountpoint", "Size", "In use", "Created"]}
      emptyTitle="No volumes"
      emptyText="No volumes exist on this daemon."
    >
      {(rows) =>
        rows.map((v) => (
          <TableRow key={v.name}>
            <TableCell className="pl-4 font-mono text-xs font-medium">
              {v.name}
            </TableCell>
            <TableCell className="text-muted-foreground">{v.driver}</TableCell>
            <TableCell
              className="max-w-[280px] truncate font-mono text-xs text-muted-foreground"
              title={v.mountpoint}
            >
              {v.mountpoint}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatBytes(v.size)}
            </TableCell>
            <TableCell>
              {v.refCount < 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : v.refCount > 0 ? (
                <Badge variant="default">{v.refCount}</Badge>
              ) : (
                <Badge variant="secondary">orphan</Badge>
              )}
            </TableCell>
            <TableCell className="pr-4 text-muted-foreground">
              {v.createdAt != null ? timeAgoSeconds(v.createdAt) : "—"}
            </TableCell>
          </TableRow>
        ))
      }
    </Panel>
  );
}

export function NetworksTable({ query }: { query: QueryLike<Network> }) {
  return (
    <Panel
      query={query}
      headers={["Name", "Driver", "Scope", "Internal", "Attached", "Created"]}
      emptyTitle="No networks"
      emptyText="No networks exist on this daemon."
    >
      {(rows) =>
        rows.map((n) => (
          <TableRow key={n.id}>
            <TableCell className="pl-4 font-mono text-xs font-medium">
              {n.name}
            </TableCell>
            <TableCell>
              <Badge variant={n.driver === "overlay" ? "default" : "secondary"}>
                {n.driver}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">{n.scope}</TableCell>
            <TableCell className="text-muted-foreground">
              {n.internal ? "yes" : "no"}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {n.containers}
            </TableCell>
            <TableCell className="pr-4 text-muted-foreground">
              {timeAgoSeconds(n.createdAt)}
            </TableCell>
          </TableRow>
        ))
      }
    </Panel>
  );
}

export function TasksTable({ query }: { query: QueryLike<Task> }) {
  return (
    <Panel
      query={query}
      headers={["Service", "Slot", "Node", "Desired", "State", "Message"]}
      emptyTitle="No tasks"
      emptyText="No swarm tasks. This daemon may not be a swarm manager."
    >
      {(rows) =>
        rows.map((t) => (
          <TableRow key={t.id}>
            <TableCell className="pl-4 font-mono text-xs font-medium">
              {shortId(t.serviceId)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {t.slot ?? "—"}
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">
              {shortId(t.nodeId)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {t.desiredState || "—"}
            </TableCell>
            <TableCell>
              <StateBadge state={t.state} />
            </TableCell>
            <TableCell
              className={cn(
                "pr-4",
                t.message ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {t.message ?? "—"}
            </TableCell>
          </TableRow>
        ))
      }
    </Panel>
  );
}
