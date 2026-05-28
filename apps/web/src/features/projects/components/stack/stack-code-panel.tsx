/**
 * Bottom slide-up "Stack code" panel for the project graph view.
 *
 * Editable YAML driven by `project.stack.diff` (load), `.save`
 * (persist), and `.apply` (push to swarm). Apply walks the saved file
 * and pushes env-var changes through the existing extra-env mutator
 * for database services; service resources are surfaced as "skipped"
 * via toast.
 */

import { useState } from "react";

import { type Id, type ID_PREFIX } from "@otterdeploy/shared/id";

import { cn } from "@/shared/lib/utils";

import { PanelFooter, type PanelViewMode } from "./panel-footer";
import { PanelHeader, type StackTab } from "./panel-header";
import { useStackState } from "./use-stack-state";
import { YamlEditor } from "./yaml-editor";
import { YamlView } from "./yaml-view";

type ProjectId = Id<typeof ID_PREFIX.project>;

export interface StackCodePanelProps {
  projectId: ProjectId;
  projectSlug: string;
}

export function StackCodePanel({ projectId, projectSlug }: StackCodePanelProps) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<StackTab>("stack");
  const [view, setView] = useState<PanelViewMode>("edit");
  const stack = useStackState({ projectId });

  const filename = `${projectSlug}.stack.yaml`;
  const lineCount = stack.buffer ? stack.buffer.split("\n").length : 0;

  return (
    <div
      className={cn(
        "pointer-events-auto absolute inset-x-0 bottom-0 z-20",
        "flex flex-col overflow-hidden rounded-t-xl border border-b-0 border-border/60",
        "bg-background/95 backdrop-blur transition-[height] duration-200 ease-out",
        open ? "h-[360px]" : "h-10",
      )}
    >
      <PanelHeader
        tab={tab}
        onTabChange={setTab}
        open={open}
        onToggle={() => setOpen((v) => !v)}
        dirty={stack.dirty}
      />

      {open && (
        <>
          <div className="flex-1 overflow-hidden border-y border-border/40 bg-background/60">
            {tab === "stack" ? (
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
            ) : (
              <Placeholder kind={tab} />
            )}
          </div>
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
        </>
      )}
    </div>
  );
}

function Placeholder({ kind }: { kind: "activity" | "traffic" }) {
  return (
    <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
      {kind === "activity" ? "Activity feed — coming soon" : "Traffic chart — coming soon"}
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
  return (
    <div className="px-3 py-2 font-mono text-[12px] text-muted-foreground">
      {text}
    </div>
  );
}
