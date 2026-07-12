/**
 * Bottom slide-up drawer for the project graph view: Stack code (editable
 * YAML via `project.stack.diff` / `.save` / `.apply` — the ⌘S flow), a live
 * project Activity feed, and a per-host Traffic table. Open/tab/height are
 * persisted per project (see use-panel-state); the top edge drag-resizes
 * between 160px and 70vh. The state hook is owned by the graph layout so the
 * canvas can lift its bottom chrome above the drawer.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { useState } from "react";

import { cn } from "@/shared/lib/utils";

import { ActivityPanel } from "./activity-panel";
import { PanelFooter, type PanelViewMode } from "./panel-footer";
import { PanelHeader } from "./panel-header";
import { TrafficPanel } from "./traffic-panel";
import { PANEL_COLLAPSED_HEIGHT, type StackPanelState } from "./use-panel-state";
import { useStackState } from "./use-stack-state";
import { YamlEditor } from "./yaml-editor";
import { YamlView } from "./yaml-view";

export interface StackCodePanelProps {
  projectId: ProjectId;
  projectSlug: string;
  panel: StackPanelState;
}

export function StackCodePanel({ projectId, projectSlug, panel }: StackCodePanelProps) {
  const [view, setView] = useState<PanelViewMode>("edit");
  const stack = useStackState({ projectId });

  const filename = `${projectSlug}.stack.yaml`;
  const lineCount = stack.buffer ? stack.buffer.split("\n").length : 0;

  return (
    <div
      style={{ height: panel.open ? panel.height : PANEL_COLLAPSED_HEIGHT }}
      className={cn(
        "pointer-events-auto absolute inset-x-0 bottom-0 z-20",
        "flex flex-col overflow-hidden rounded-t-xl border border-b-0 border-border/60",
        "bg-background/95 backdrop-blur",
        // Suppress the height transition mid-drag so the drawer tracks the
        // pointer 1:1 instead of easing behind it.
        !panel.dragging && "transition-[height] duration-200 ease-out",
      )}
    >
      {/* Drag handle — a slim strip along the top edge. */}
      {panel.open && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize panel"
          onPointerDown={panel.startDrag}
          className="group absolute inset-x-0 top-0 z-30 flex h-2 cursor-ns-resize items-start justify-center"
        >
          <div className="mt-0.5 h-1 w-10 rounded-full bg-border opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      )}

      <PanelHeader
        tab={panel.tab}
        onTabChange={panel.setTab}
        open={panel.open}
        onToggle={panel.toggleOpen}
        dirty={stack.dirty}
      />

      {panel.open && (
        <>
          <div className="flex-1 overflow-hidden border-y border-border/40 bg-background/60">
            {panel.tab === "stack" ? (
              <StackBody
                view={view}
                editing={stack.editing}
                buffer={stack.buffer}
                onBufferChange={stack.setBuffer}
                diff={stack.diff}
                isLoading={stack.isLoading}
                isError={stack.isError}
                onSubmit={() => void stack.saveAndApply()}
                disabled={stack.isSaving}
              />
            ) : panel.tab === "activity" ? (
              <ActivityPanel projectId={projectId} />
            ) : (
              <TrafficPanel projectId={projectId} />
            )}
          </div>
          {/* Footer (filename / edit / diff / ⌘S Apply) belongs to the stack
              file — the feed tabs stand on their own. */}
          {panel.tab === "stack" && (
            <PanelFooter
              filename={filename}
              lineCount={lineCount}
              view={view}
              onViewChange={setView}
              editing={stack.editing}
              onEditToggle={() => stack.setEditing((p) => !p)}
              dirty={stack.dirty}
              isSaving={stack.isSaving}
              onDiscard={stack.discard}
              onApply={() => void stack.saveAndApply()}
            />
          )}
        </>
      )}
    </div>
  );
}

interface StackBodyProps {
  view: PanelViewMode;
  editing: boolean;
  buffer: string;
  onBufferChange: (next: string) => void;
  diff: string;
  isLoading: boolean;
  isError: boolean;
  onSubmit: () => void;
  disabled: boolean;
}

function StackBody({
  view,
  editing,
  buffer,
  onBufferChange,
  diff,
  isLoading,
  isError,
  onSubmit,
  disabled,
}: StackBodyProps) {
  if (isLoading) return <ViewMessage text="# loading stack file…" />;
  if (isError) return <ViewMessage text="# failed to load stack file" />;
  if (view === "diff") {
    return <YamlView source={diff || "# no diff — rendered matches saved"} />;
  }
  if (editing) {
    return (
      <YamlEditor
        value={buffer}
        onChange={onBufferChange}
        onSubmit={onSubmit}
        disabled={disabled}
      />
    );
  }
  return <YamlView source={buffer} />;
}

function ViewMessage({ text }: { text: string }) {
  return <div className="px-3 py-2 font-mono text-[12px] text-muted-foreground">{text}</div>;
}
