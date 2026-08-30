/**
 * The compose panel's tab strip and bodies. Lifted out of panel.tsx under the
 * file/function caps; the panel keeps the data wiring, this keeps the layout.
 *
 * The draft/live split lives here too: Variables and Compose read from the
 * STAGED manifest while a stack has not deployed yet, which is what makes a
 * template's domain editable before its first deploy rather than after.
 */
import type { ProjectSlug } from "@otterdeploy/shared/id";

import type { PanelFocus } from "@/features/resources/components/_shared/panel-tab";
import type { ResourceState } from "@/features/resources/lib/resource-state";

import { PanelTabsLayout } from "@/features/resources/components/_shared/panel-tabs-layout";
import { PANE_MEASURE_CLASS } from "@/features/resources/components/_shared/panel-width";
import { ResourceLogsTab } from "@/features/resources/components/_shared/resource-logs-tab";
import { ResourceTasksTab } from "@/features/resources/components/_shared/resource-tasks-tab";
import { TabsContent } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";

import type { StackMember } from "../_shared/use-stack-members";
import type { ComposeService } from "./panel-parts";

import { ComposeFileTab, ComposeSettingsTab } from "./panel-tabs";
import { StackDraftVariablesTab } from "./stack-draft-variables-tab";
import { StackOverviewTab } from "./stack-overview-tab";
import { StackVariablesTab } from "./stack-variables-tab";

export function ComposePanelTabs({
  tab,
  onTabChange,
  pending,
  resource,
  services,
  members,
  state,
  orgSlug,
  projectSlug,
  focus,
  onOpenMember,
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
  /** The members with their state (live), or the file's declared services
   *  each pending (draft). */
  members: StackMember[];
  state: ResourceState | null;
  orgSlug: string;
  projectSlug: ProjectSlug;
  focus: PanelFocus;
  onOpenMember: (resourceId: string) => void;
  draftContent: string | null;
  fileLoading: boolean;
  fileContent: string | null | undefined;
  onDelete: () => void;
  deleting: boolean;
}) {
  const memberIds = members.flatMap((m) => (m.resourceId ? [m.resourceId] : []));
  return (
    <PanelTabsLayout
      value={tab}
      onValueChange={onTabChange}
      tabs={[
        // Deployments, Logs and Settings genuinely need a resource row, so
        // they stay closed while staged. Overview (the members), Variables
        // and Compose do not: they are what an operator has to set BEFORE the
        // first deploy (a template's domain among them).
        { value: "overview", label: "Overview" },
        { value: "deployments", label: "Deployments", disabled: pending },
        { value: "logs", label: "Logs", disabled: pending },
        { value: "variables", label: "Variables" },
        { value: "settings", label: "Settings", disabled: pending },
        { value: "compose", label: "Compose" },
      ]}
    >
      <TabsContent value="overview" className="px-4 pt-5 sm:px-6">
        <StackOverviewTab
          state={state}
          members={members}
          pending={pending}
          projectId={resource.projectId}
          resourceId={resource.resourceId}
          focus={focus}
          onOpenMember={onOpenMember}
          onGoTab={onTabChange}
        />
      </TabsContent>

      {!pending && (
        <TabsContent value="deployments" className="px-4 pt-5 sm:px-6">
          <ResourceTasksTab
            projectId={resource.projectId}
            resourceId={resource.resourceId}
            focus={focus}
          />
        </TabsContent>
      )}

      {/* Every member's output in one tail, prefixed by member. Mounted on
          visit only: a stack's stream is N containers wide. */}
      {!pending && tab === "logs" && (
        <TabsContent value="logs" className="flex h-full min-h-0 flex-col px-4 pt-5 sm:px-6">
          {memberIds.length > 0 ? (
            <ResourceLogsTab
              projectId={resource.projectId}
              resourceId={resource.resourceId}
              resourceIds={memberIds}
              focus={focus}
            />
          ) : (
            <p className="text-[12.5px] text-muted-foreground">
              No member has a container yet.
            </p>
          )}
        </TabsContent>
      )}

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
          onDelete={onDelete}
          deleting={deleting}
        />
      </TabsContent>

      <TabsContent value="compose" className="px-4 pt-5 sm:px-6">
        <ComposeFileTab
          projectId={resource.projectId}
          resourceId={resource.resourceId}
          source={resource.source}
          isLoading={pending ? false : fileLoading}
          composeContent={pending ? (draftContent ?? undefined) : (fileContent ?? undefined)}
        />
      </TabsContent>
    </PanelTabsLayout>
  );
}
