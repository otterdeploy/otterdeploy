import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { OuterRail } from "./outer-rail";
import { BreadcrumbBar } from "./breadcrumb-bar";
import type { WorkspaceSummary } from "@/features/workspace-switcher";

const placeholderWorkspace: WorkspaceSummary = {
  id: "ws_default",
  name: "otterstack",
  slug: "otterstack",
  role: "owner",
};

const placeholderWorkspaces: ReadonlyArray<WorkspaceSummary> = [placeholderWorkspace];

type Props = {
  /** Optional middle breadcrumb content (project switcher + env switcher). */
  middle?: ReactNode;
  /** Optional second rail (rendered to the right of OuterRail when set). */
  innerRail?: ReactNode;
  children: ReactNode;
};

export function WorkspaceShell({ middle, innerRail, children }: Props) {
  const location = useRouterState({ select: (s) => s.location.pathname });

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
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
        }}
      />
      <div className="grid min-h-0 grid-cols-[auto_auto_1fr]">
        <OuterRail currentHref={location} />
        {innerRail ?? <div />}
        <main className="min-h-0 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
