/**
 * Header block for the Docker panel: the tab strip with live counts, with
 * the refresh hint and the swarm-only node filter (Tasks tab) on the same
 * row, plus the manager-scope caption shown on the per-daemon tabs. The
 * panel already sits under the Servers page's Docker tab, so it carries no
 * title of its own. Rendered inside the panel's <Tabs> so
 * TabsList/TabsTrigger keep context.
 */
import { Badge } from "@/shared/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { TabsList, TabsTrigger } from "@/shared/components/ui/tabs";

export const DOCKER_TABS = [
  "containers",
  "images",
  "volumes",
  "networks",
  "tasks",
  "events",
] as const;
export type DockerTab = (typeof DOCKER_TABS)[number];

/** Narrow an arbitrary tab-strip value to a DockerTab without asserting -
 *  the tuple lookup is the type guard. */
export function toDockerTab(value: string): DockerTab {
  return DOCKER_TABS.find((tab) => tab === value) ?? "containers";
}

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
    <div className="flex items-center justify-between gap-3 border-b px-6 pb-0 pt-4">
      <TabsList variant="line" className="h-9 justify-start gap-1">
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

      <div className="flex items-center gap-3 pb-1.5">
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
    </div>
  );
}

/** Caption for the per-daemon tabs when this deployment is a swarm. The
 *  inventory below is the manager daemon's local state, not cluster-wide. */
export function ManagerScopeCaption({ swarm, tab }: { swarm: boolean; tab: DockerTab }) {
  if (!swarm || tab === "tasks") return null;
  return (
    <p className="mb-3 text-xs text-muted-foreground">
      Scope: manager node&apos;s daemon. Per-node{" "}
      {tab === "containers" ? "container" : tab.slice(0, -1)} listing isn&apos;t reachable from
      the control plane; only swarm tasks carry a node.
    </p>
  );
}
