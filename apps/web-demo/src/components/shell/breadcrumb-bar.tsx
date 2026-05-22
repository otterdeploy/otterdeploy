import type { ReactNode } from "react";
import { BellIcon } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { ModeToggle } from "@/components/mode-toggle";
import UserMenu from "@/components/user-menu";
import {
  WorkspaceSwitcherDropdown,
  type WorkspaceSummary,
} from "@/features/workspace-switcher";

type Props = {
  workspace: WorkspaceSummary;
  workspaces: ReadonlyArray<WorkspaceSummary>;
  onSelectWorkspace: (workspaceId: string) => void;
  /** Optional middle slot rendered between workspace switcher and the spacer (e.g. project + env switcher). */
  middle?: ReactNode;
  onOpenCommandPalette: () => void;
};

export function BreadcrumbBar({
  workspace,
  workspaces,
  onSelectWorkspace,
  middle,
  onOpenCommandPalette,
}: Props) {
  return (
    <header className="flex h-10 items-center gap-2 border-b border-border bg-background px-3 text-sm">
      <WorkspaceSwitcherDropdown
        current={workspace}
        workspaces={workspaces}
        onSelect={onSelectWorkspace}
      />
      {middle ? (
        <>
          <Separator orientation="vertical" className="mx-1 h-4" />
          {middle}
        </>
      ) : null}
      <div className="flex-1" />
      <button
        type="button"
        onClick={onOpenCommandPalette}
        className="inline-flex h-7 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground hover:bg-accent"
      >
        <span>Search</span>
        <Kbd>⌘K</Kbd>
      </button>
      <button
        type="button"
        aria-label="Notifications"
        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
      >
        <BellIcon className="size-4" />
      </button>
      <ModeToggle />
      <UserMenu />
    </header>
  );
}
