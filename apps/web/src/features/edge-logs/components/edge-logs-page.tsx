import { FirewallView } from "@/features/firewall/components/firewall-view";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";

import type { EdgeTab } from "../data/edge-search";

import { EdgeEventsView } from "./edge-events-view";
import { EdgeLogsView } from "./edge-logs-view";

/**
 * Edge logs page. The per-request **access** log is always shown. The
 * operational **events** plane (cert/ACME lifecycle, upstream errors) spans the
 * whole edge, so it's only offered at the org level (no `projectId`) behind the
 * shared animated `line` tabs — a single project's view stays focused on its
 * own traffic. The page owns the viewport height so the active view fills it.
 *
 * Org scope drives the active tab off the URL (`?tab=`) via `tab` /
 * `onTabChange` from the route, so each plane is deep-linkable. Project scope
 * shows the access log only, with no tab chrome.
 */
export function EdgeLogsPage({
  projectId,
  tab,
  onTabChange,
}: {
  projectId?: string;
  tab?: EdgeTab;
  onTabChange?: (tab: EdgeTab) => void;
}) {
  // Project scope: access log only, no tab chrome.
  if (projectId) {
    return (
      <div className="flex h-[calc(100svh-var(--header-height))] min-w-0 flex-col overflow-hidden">
        <EdgeLogsView projectId={projectId} />
      </div>
    );
  }

  // Org scope: access + operational events + firewall behind the shared
  // animated tabs. Controlled by the URL search param (see `zEdgeLogsSearch`).
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTabChange?.(value as EdgeTab)}
      className="flex h-[calc(100svh-var(--header-height))] min-w-0 flex-col gap-0 overflow-hidden"
    >
      <div className="flex items-center border-b px-4 pt-2">
        <TabsList variant="line" className="h-auto bg-transparent p-0">
          <TabsTrigger value="logs" className="px-3 py-2">
            Access
          </TabsTrigger>
          <TabsTrigger value="caddy" className="px-3 py-2">
            Events
          </TabsTrigger>
          <TabsTrigger value="firewall" className="px-3 py-2">
            Firewall
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="logs" className="min-h-0 flex-1">
        <EdgeLogsView />
      </TabsContent>
      <TabsContent value="caddy" className="min-h-0 flex-1">
        <EdgeEventsView />
      </TabsContent>
      <TabsContent value="firewall" className="min-h-0 flex-1">
        <FirewallView />
      </TabsContent>
    </Tabs>
  );
}
