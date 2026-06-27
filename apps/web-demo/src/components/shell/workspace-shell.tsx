import type { ReactNode } from "react";

import { useRouterState } from "@tanstack/react-router";

import type { WorkspaceSummary } from "@/features/workspace-switcher";

import { BreadcrumbBar } from "./breadcrumb-bar";
import { OuterRail } from "./outer-rail";
import { WorkspaceSettingsRail } from "./workspace-settings-rail";

const placeholderWorkspace: WorkspaceSummary = {
  id: "ws_default",
  name: "otterdeploy",
  slug: "otterdeploy",
  role: "owner",
};

const placeholderWorkspaces: ReadonlyArray<WorkspaceSummary> = [placeholderWorkspace];

interface Props {
  /** Optional middle breadcrumb content (project switcher + env switcher). */
  middle?: ReactNode;
  /** Optional second rail (rendered to the right of OuterRail when set). */
  innerRail?: ReactNode;
  children: ReactNode;
}

export function WorkspaceShell({ middle, innerRail, children }: Props) {
  const location = useRouterState({ select: (s) => s.location.pathname });
  const settingsRail = location.startsWith("/settings") ? <WorkspaceSettingsRail /> : null;

  return (
    <div className="grid h-svh grid-rows-[auto_1fr]">
      <BreadcrumbBar
        workspace={placeholderWorkspace}
        workspaces={placeholderWorkspaces}
        onSelectWorkspace={() => {
          // real wiring lands in Plan 3
        }}
        middle={middle}
        onOpenCommandPalette={() => {
          // TODO(plan-5): replace synthetic keyboard event with a shared open-state context. The CommandPalette listens for keydown on document; this dispatch piggybacks on that listener so the button click reaches the same code path. Brittle: any future global Cmd+K handler will see this fake event.
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
        }}
      />
      <div className="grid min-h-0 grid-cols-[auto_auto_1fr]">
        <OuterRail currentHref={location} />
        {innerRail ?? settingsRail ?? <div />}
        <main className="min-h-0 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
