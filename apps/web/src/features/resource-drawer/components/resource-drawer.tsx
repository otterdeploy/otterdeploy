import { Sheet, SheetPopup, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTab, TabsPanel } from "@/components/ui/tabs";
import { OverviewTab } from "./tabs/overview-tab";
import { DeploymentsTab } from "./tabs/deployments-tab";
import { VariablesTab } from "./tabs/variables-tab";
import { LogsTab } from "./tabs/logs-tab";
import { SettingsTab } from "./tabs/settings-tab";
import type { DrawerSelection } from "../types";

type Props = {
  open: boolean;
  selection: DrawerSelection;
  onClose: () => void;
  onDeleted: () => void;
  /** Display label for the drawer header (the resource's user-visible name). */
  resourceName: string;
};

export function ResourceDrawer({ open, selection, onClose, onDeleted, resourceName }: Props) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetPopup side="right" className="w-[480px] p-0 sm:max-w-none">
        {selection ? (
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b">
              <SheetTitle>{resourceName}</SheetTitle>
              <SheetDescription>
                {selection.kind === "database" ? "Postgres database" : "Resource"}
              </SheetDescription>
            </SheetHeader>
            <Tabs defaultValue="overview" className="flex flex-1 flex-col overflow-hidden">
              <TabsList className="border-b px-3">
                <TabsTab value="overview">Overview</TabsTab>
                <TabsTab value="deployments">Deployments</TabsTab>
                <TabsTab value="variables">Variables</TabsTab>
                <TabsTab value="logs">Logs</TabsTab>
                <TabsTab value="settings">Settings</TabsTab>
              </TabsList>
              <TabsPanel value="overview" className="flex-1 overflow-y-auto">
                {selection.kind === "database" ? (
                  <OverviewTab projectId={selection.projectId} resourceId={selection.resourceId} />
                ) : null}
              </TabsPanel>
              <TabsPanel value="deployments" className="flex-1 overflow-y-auto">
                <DeploymentsTab />
              </TabsPanel>
              <TabsPanel value="variables" className="flex-1 overflow-y-auto">
                <VariablesTab />
              </TabsPanel>
              <TabsPanel value="logs" className="flex-1 overflow-y-auto">
                <LogsTab />
              </TabsPanel>
              <TabsPanel value="settings" className="flex-1 overflow-y-auto">
                {selection.kind === "database" ? (
                  <SettingsTab
                    projectId={selection.projectId}
                    resourceId={selection.resourceId}
                    name={resourceName}
                    onDeleted={onDeleted}
                  />
                ) : null}
              </TabsPanel>
            </Tabs>
          </div>
        ) : null}
      </SheetPopup>
    </Sheet>
  );
}
