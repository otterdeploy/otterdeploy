import { ContainerIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { PageHeader } from "@/shared/components/page";
import { Badge } from "@/shared/components/ui/badge";
import { Card } from "@/shared/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/shared/components/ui/pagination";
import { ErrorState } from "@/shared/components/ui/error-state";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/docker")({
  staticData: { crumb: "Docker" },
  component: DockerRoute,
});

type Tab = "containers" | "images" | "volumes" | "networks" | "tasks";

function DockerRoute() {
  const [tab, setTab] = useState<Tab>("containers");

  // Containers/images/volumes/networks work on any daemon, so they load
  // eagerly to populate the tab counts. Tasks need Swarm mode, so it's lazy —
  // polling it on a non-swarm daemon would error every tick and spam toasts.
  const containers = useQuery({
    ...orpc.docker.containers.list.queryOptions({ input: { all: true } }),
    refetchInterval: 5000,
  });
  const images = useQuery({
    ...orpc.docker.images.list.queryOptions({ input: { all: false } }),
    staleTime: 10_000,
  });
  const volumes = useQuery({
    ...orpc.docker.volumes.list.queryOptions({ input: {} }),
    staleTime: 10_000,
  });
  const networks = useQuery({
    ...orpc.docker.networks.list.queryOptions({ input: {} }),
    staleTime: 10_000,
  });
  const tasks = useQuery({
    ...orpc.docker.tasks.list.queryOptions({ input: {} }),
    enabled: tab === "tasks",
    staleTime: 10_000,
  });

  const tabs: Array<[Tab, string, number | undefined]> = [
    ["containers", "Containers", containers.data?.length],
    ["images", "Images", images.data?.length],
    ["volumes", "Volumes", volumes.data?.length],
    ["networks", "Networks", networks.data?.length],
    ["tasks", "Tasks", tasks.data?.length],
  ];

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as Tab)}
      className="flex flex-1 flex-col gap-0"
    >
      <div className="border-b px-6 pb-0 pt-6">
        <PageHeader
          title="Docker"
          description="Raw daemon-level inventory — containers, images, volumes, networks, and swarm tasks outside the project and Stack abstraction."
          actions={
            <span className="text-xs text-muted-foreground">
              {containers.isFetching ? "refreshing…" : null}
            </span>
          }
        />

        <TabsList variant="line" className="mt-3.5 h-9 justify-start gap-1">
          {tabs.map(([id, label, count]) => (
            <TabsTrigger key={id} value={id} className="gap-1.5">
              <span>{label}</span>
              {count !== undefined && (
                <Badge
                  variant="secondary"
                  className="ml-1 h-4 rounded-sm px-1.5 font-mono text-[10px]"
                >
                  {count}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <TabsContent value="containers">
          <ContainersTable query={containers} />
        </TabsContent>
        <TabsContent value="images">
          <ImagesTable query={images} />
        </TabsContent>
        <TabsContent value="volumes">
          <VolumesTable query={volumes} />
        </TabsContent>
        <TabsContent value="networks">
          <NetworksTable query={networks} />
        </TabsContent>
        <TabsContent value="tasks">
          <TasksTable query={tasks} />
        </TabsContent>
      </div>
    </Tabs>
  );
}

interface QueryLike<T> {
  data?: T[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

function ContainersTable({ query }: { query: QueryLike<Container> }) {
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

function ImagesTable({ query }: { query: QueryLike<Image> }) {
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

function VolumesTable({ query }: { query: QueryLike<Volume> }) {
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

function NetworksTable({ query }: { query: QueryLike<Network> }) {
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

function TasksTable({ query }: { query: QueryLike<Task> }) {
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

// --- Shared panel + helpers ------------------------------------------------

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

const PAGE_SIZE = 10;

function Panel<T>({
  query,
  headers,
  emptyTitle,
  emptyText,
  children,
}: {
  query: QueryLike<T>;
  headers: string[];
  emptyTitle: string;
  emptyText: string;
  children: (rows: T[]) => React.ReactNode;
}) {
  // Page state lives here so each tab (Panel remounts per tab) starts at
  // page 1. Polling refetches can shrink the list, so the render clamps the
  // index into range rather than tracking total separately.
  const [page, setPage] = useState(0);

  if (query.isLoading) return <PanelSkeleton cols={headers.length} />;
  if (query.isError) {
    return (
      <ErrorState
        title="Couldn't reach the Docker daemon"
        message={(query.error as Error | null)?.message}
        onRetry={() => query.refetch()}
      />
    );
  }
  const rows = query.data ?? [];
  if (rows.length === 0) {
    return (
      <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
        <EmptyHeader>
          <HugeiconsIcon
            icon={ContainerIcon}
            strokeWidth={1.5}
            className="size-10 text-muted-foreground/50"
          />
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>{emptyText}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  return (
    <Card className="overflow-hidden rounded-md p-0 gap-0">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((h, i) => (
              <TableHead
                key={h}
                className={cn(
                  i === 0 && "pl-4",
                  i === headers.length - 1 && "pr-4",
                )}
              >
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children(pageRows)}</TableBody>
      </Table>
      {rows.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-4 border-t px-4 py-2.5">
          <span className="text-xs text-muted-foreground">
            Showing{" "}
            <span className="font-mono text-foreground">
              {start + 1}–{Math.min(start + PAGE_SIZE, rows.length)}
            </span>{" "}
            of <span className="font-mono text-foreground">{rows.length}</span>
          </span>
          <TablePager page={safePage} pageCount={pageCount} onPage={setPage} />
        </div>
      )}
    </Card>
  );
}

/** Windowed page list: first/last always shown, current ±1, ellipsis fills gaps. */
function pageWindow(
  current: number,
  total: number,
): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const out: Array<number | "ellipsis"> = [0];
  const left = Math.max(1, current - 1);
  const right = Math.min(total - 2, current + 1);
  if (left > 1) out.push("ellipsis");
  for (let i = left; i <= right; i++) out.push(i);
  if (right < total - 2) out.push("ellipsis");
  out.push(total - 1);
  return out;
}

function TablePager({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
}) {
  const atStart = page === 0;
  const atEnd = page >= pageCount - 1;
  return (
    <Pagination className="mx-0 w-auto justify-end">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            text=""
            aria-disabled={atStart}
            className={cn(atStart && "pointer-events-none opacity-50")}
            onClick={(e) => {
              e.preventDefault();
              if (!atStart) onPage(page - 1);
            }}
          />
        </PaginationItem>
        {pageWindow(page, pageCount).map((it, i) =>
          it === "ellipsis" ? (
            <PaginationItem key={`ellipsis-${i}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={it}>
              <PaginationLink
                isActive={it === page}
                onClick={(e) => {
                  e.preventDefault();
                  onPage(it);
                }}
              >
                {it + 1}
              </PaginationLink>
            </PaginationItem>
          ),
        )}
        <PaginationItem>
          <PaginationNext
            text=""
            aria-disabled={atEnd}
            className={cn(atEnd && "pointer-events-none opacity-50")}
            onClick={(e) => {
              e.preventDefault();
              if (!atEnd) onPage(page + 1);
            }}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

function PanelSkeleton({ cols }: { cols: number }) {
  return (
    <Card className="overflow-hidden rounded-md p-0 gap-0">
      <div className="flex items-center gap-4 border-b bg-muted/50 px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-16" />
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, r) => (
        <div
          key={r}
          className="flex items-center gap-4 border-b border-border/60 px-4 py-3 last:border-b-0"
        >
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-4 w-20 flex-1" />
          ))}
        </div>
      ))}
    </Card>
  );
}

function StateBadge({ state }: { state: string }) {
  const s = state.toLowerCase();
  const variant =
    s === "running"
      ? "default"
      : s === "exited" || s === "dead" || s === "failed" || s === "rejected"
        ? "destructive"
        : "secondary";
  return <Badge variant={variant}>{state || "—"}</Badge>;
}

/** Strip a Docker `sha256:…`/long id down to the conventional 12 chars. */
function shortId(id: string): string {
  return id.replace(/^sha256:/, "").slice(0, 12) || "—";
}

/** Split an image ref into repo + tag on the final colon (registry ports keep their colon). */
function splitRef(ref: string): { repo: string; tag: string } {
  const i = ref.lastIndexOf(":");
  if (i === -1) return { repo: ref, tag: "" };
  const tag = ref.slice(i + 1);
  if (tag.includes("/")) return { repo: ref, tag: "" };
  return { repo: ref.slice(0, i), tag };
}

function formatBytes(n: number): string {
  if (n < 0) return "—";
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(n) / Math.log(1024)),
    units.length - 1,
  );
  const v = n / 1024 ** i;
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
  ["second", 1],
];
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function timeAgoMs(ms: number): string {
  // Some daemon resources report a missing/zero/garbage timestamp; guard so a
  // single bad row can't throw "value must be finite" out of Intl and crash
  // the whole route render.
  if (!Number.isFinite(ms)) return "—";
  const diffSeconds = (ms - Date.now()) / 1000;
  const abs = Math.abs(diffSeconds);
  for (const [unit, secs] of RELATIVE_UNITS) {
    if (abs >= secs || unit === "second") {
      return rtf.format(Math.round(diffSeconds / secs), unit);
    }
  }
  return "just now";
}

/** Docker `Created`/`createdAt` is a unix timestamp in seconds across all resources. */
function timeAgoSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  return timeAgoMs(seconds * 1000);
}
