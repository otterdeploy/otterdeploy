/**
 * Header block for the Docker route — page title/actions (refresh hint + the
 * swarm-only node filter for the Tasks tab) and the tab strip with live
 * counts, plus the manager-scope caption shown on the per-daemon tabs.
 * Rendered inside the route's <Tabs> so TabsList/TabsTrigger keep context.
 */
import { PageHeader } from "@/shared/components/page";
import { Badge } from "@/shared/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { TabsList, TabsTrigger } from "@/shared/components/ui/tabs";

export type DockerTab = "containers" | "images" | "volumes" | "networks" | "tasks";

export function DockerPageHeader({
  tab,
  tabs,
  refreshing,
  swarm,
  nodeItems,
  nodeFilter,
  onNodeFilterChange,
}: {
  tab: DockerTab;
  tabs: Array<[DockerTab, string, number | undefined]>;
  refreshing: boolean;
  swarm: boolean;
  nodeItems: { value: string; label: string }[];
  nodeFilter: string;
  onNodeFilterChange: (v: string) => void;
}) {
  return (
    <div className="border-b px-6 pb-0 pt-6">
      <PageHeader
        title="Docker"
        description="Raw daemon-level inventory — containers, images, volumes, networks, and swarm tasks outside the project and Stack abstraction."
        actions={
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {refreshing ? "refreshing…" : null}
            </span>
            {swarm && tab === "tasks" && nodeItems.length > 1 && (
              <Select
                items={nodeItems}
                value={nodeFilter}
                onValueChange={(v) => onNodeFilterChange(v ?? "all")}
              >
                <SelectTrigger className="h-8 w-48" aria-label="Filter tasks by node">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {nodeItems.map((it) => (
                    <SelectItem key={it.value} value={it.value}>
                      {it.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
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
  );
}

/** Caption for the per-daemon tabs when this deployment is a swarm — the
 *  inventory below is the manager daemon's local state, not cluster-wide. */
export function ManagerScopeCaption({ swarm, tab }: { swarm: boolean; tab: DockerTab }) {
  if (!swarm || tab === "tasks") return null;
  return (
    <p className="mb-3 text-xs text-muted-foreground">
      Scope: manager node&apos;s daemon. Per-node{" "}
      {tab === "containers" ? "container" : tab.slice(0, -1)} listing isn&apos;t reachable from
      the control plane — only swarm tasks carry a node.
    </p>
  );
}
