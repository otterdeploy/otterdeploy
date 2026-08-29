/**
 * The compose panel's tab strip and bodies. Lifted out of panel.tsx under the
 * file/function caps; the panel keeps the data wiring, this keeps the layout.
 *
 * The draft/live split lives here too: Variables and Compose read from the
 * STAGED manifest while a stack has not deployed yet, which is what makes a
 * template's domain editable before its first deploy rather than after.
 */
import type { ProjectSlug } from "@otterdeploy/shared/id";

import type { PanelRailChild } from "@/features/resources/components/_shared/panel-tabs-layout";

import { PanelTabsLayout } from "@/features/resources/components/_shared/panel-tabs-layout";
import { PANE_MEASURE_CLASS } from "@/features/resources/components/_shared/panel-width";
import { ResourceTasksTab } from "@/features/resources/components/_shared/resource-tasks-tab";
import { TabsContent } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";

import type { ComposeService, StackServiceStatus } from "./panel-parts";

import { ComposeFileTab, ComposeServicesTab, ComposeSettingsTab } from "./panel-tabs";
import { StackDraftVariablesTab } from "./stack-draft-variables-tab";
import { StackVariablesTab } from "./stack-variables-tab";

export function ComposePanelTabs({
  tab,
  onTabChange,
  pending,
  resource,
  services,
  serviceStatus,
  railChildren,
  orgSlug,
  projectSlug,
  draftContent,
  fileLoading,
  fileContent,
  onDelete,
  deleting,
}: {
  tab: string;
  onTabChange: (tab: string) => void;
  pending: boolean;
  resource: {
    projectId: string;
    resourceId: string;
    name: string;
    stackName: string;
    source: "inline" | "git";
    stageEnv?: Record<string, string>;
  };
  services: ComposeService[];
  serviceStatus: (serviceName: string) => StackServiceStatus;
  railChildren: PanelRailChild[];
  orgSlug: string;
  projectSlug: ProjectSlug;
  draftContent: string | null;
  fileLoading: boolean;
  fileContent: string | null | undefined;
  onDelete: (opts: { keepVolumes: boolean }) => void;
  deleting: boolean;
}) {
  return (
    <PanelTabsLayout
      value={tab}
      onValueChange={onTabChange}
      tabs={[
        // Deployments and Settings genuinely need a resource row, so they
        // stay closed while staged. Variables and Compose do not: they are
        // what an operator has to set BEFORE the first deploy (a template's
        // domain among them), and disabling them was the reason a staged
        // stack could only be deployed blank.
        { value: "deployments", label: "Deployments", disabled: pending },
        { value: "services", label: "Services", count: services.length },
        { value: "variables", label: "Variables" },
        { value: "file", label: "Compose" },
        { value: "settings", label: "Settings", disabled: pending },
      ]}
      // Expanded, the stack's children hang off its Services tab, so moving
      // between the stack and one of its services is one click rather than a
      // trip back to the canvas. Each is a real resource with its own URL.
      nested={{ under: "services", items: railChildren }}
    >
      <TabsContent value="deployments" className="px-4 pt-5 sm:px-6">
        <ResourceTasksTab
          projectId={resource.projectId}
          resourceId={resource.resourceId}
          orgSlug={orgSlug}
          projectSlug={projectSlug}
        />
      </TabsContent>

      <TabsContent value="services" className="px-4 pt-5 sm:px-6">
        <ComposeServicesTab
          services={services}
          source={resource.source}
          serviceStatus={serviceStatus}
        />
      </TabsContent>

      <TabsContent value="variables" className="px-4 pt-5 sm:px-6">
        {pending ? (
          <StackDraftVariablesTab
            projectId={resource.projectId}
            stackName={resource.stackName}
            composeContent={draftContent}
            stageEnv={resource.stageEnv ?? {}}
          />
        ) : (
          <StackVariablesTab projectId={resource.projectId} stackResourceId={resource.resourceId} />
        )}
      </TabsContent>

      <TabsContent value="file" className="px-4 pt-5 sm:px-6">
        <ComposeFileTab
          projectId={resource.projectId}
          resourceId={resource.resourceId}
          source={resource.source}
          isLoading={pending ? false : fileLoading}
          composeContent={pending ? (draftContent ?? undefined) : (fileContent ?? undefined)}
        />
      </TabsContent>

      {/* Settings caps at a reading measure: a form stretched across a
            full-width panel puts each label at one end and its control at the
            other. The width buys the compose file room, not this. */}
      <TabsContent value="settings" className={cn("px-4 pt-5 sm:px-6", PANE_MEASURE_CLASS)}>
        <ComposeSettingsTab
          projectId={resource.projectId}
          resourceId={resource.resourceId}
          orgSlug={orgSlug}
          projectSlug={projectSlug}
          name={resource.name}
          serviceCount={services.length}
          volumeCount={new Set(services.flatMap((s) => s.volumes)).size}
          onDelete={onDelete}
          deleting={deleting}
        />
      </TabsContent>
    </PanelTabsLayout>
  );
}
