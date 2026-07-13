/**
 * Content tabs for {@link ComposeResourcePanel} — the Services list, the
 * read-only Compose file viewer, and the Settings (exposed editor + delete)
 * pane. Pulled into a sibling module so the panel component stays small.
 */

import { useState } from "react";

import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { tags as t } from "@lezer/highlight";
import { useMutation } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import { toast } from "sonner";

import { ComposeExposedEditor } from "@/features/resources/components/compose/exposed-editor";
import { RESOURCE_COLLECTION_KEY } from "@/features/resources/data/resource";
import { TypedConfirmDialog } from "@/shared/components/typed-confirm-dialog";
import { Button } from "@/shared/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { ComposeService, StackServiceStatus } from "./panel-parts";

const stackStatusMeta: Record<StackServiceStatus, { label: string; dot: string; text: string }> = {
  running: { label: "Running", dot: "bg-success", text: "text-success" },
  building: { label: "Building", dot: "bg-warning", text: "text-warning" },
  deploying: { label: "Deploying", dot: "bg-info", text: "text-info" },
  error: { label: "Failed", dot: "bg-destructive", text: "text-destructive" },
  offline: {
    label: "Offline",
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground",
  },
  pending: { label: "Pending", dot: "bg-info", text: "text-info" },
};

// Read-only YAML viewer — transparent so it inherits the panel surface.
const editorTheme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
      lineHeight: "1.6",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      border: "none",
      color: "color-mix(in srgb, currentColor 35%, transparent)",
    },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 6px 0 10px" },
    ".cm-activeLineGutter": { backgroundColor: "transparent" },
    ".cm-activeLine": { backgroundColor: "transparent" },
  },
  { dark: true },
);

const highlightStyle = HighlightStyle.define([
  { tag: [t.definition(t.propertyName), t.propertyName], color: "#79c0ff" },
  { tag: [t.string, t.special(t.string), t.content], color: "#7ee787" },
  { tag: [t.typeName, t.labelName], color: "#ffa657" },
  {
    tag: [t.comment, t.lineComment],
    color: "var(--muted-foreground)",
    fontStyle: "italic",
  },
]);

const viewerExtensions = [editorTheme, yaml(), syntaxHighlighting(highlightStyle)];

export function ComposeServicesTab({
  services,
  source,
  serviceStatus,
}: {
  services: ComposeService[];
  source: "inline" | "git";
  serviceStatus: (name: string) => StackServiceStatus;
}) {
  if (services.length === 0) {
    return (
      <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
        <EmptyHeader>
          <EmptyTitle>No services parsed</EmptyTitle>
          <EmptyDescription>
            {source === "git"
              ? "Services appear once the stack is built from the repo."
              : "This stack's compose file declares no services."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      {services.map((s) => (
        <ServiceRow key={s.name} service={s} status={serviceStatus(s.name)} />
      ))}
    </div>
  );
}

export function ComposeFileTab({
  projectId,
  resourceId,
  source,
  isLoading,
  composeContent,
}: {
  projectId: string;
  resourceId: string;
  source: "inline" | "git";
  isLoading: boolean;
  composeContent: string | null | undefined;
}) {
  // Git stacks stay read-only — their compose file lives in the repo and is
  // resolved at build time, so editing it here would just be overwritten.
  if (source === "git") {
    return (
      <>
        <p className="mb-3 rounded-md border border-info/30 bg-info/5 px-3 py-2 text-[12px] text-muted-foreground">
          This stack builds from a repository — the compose file lives in the repo and is resolved
          at build time.
        </p>
        {isLoading ? (
          <div className="rounded-lg border bg-card px-4 py-6 text-center text-[12px] text-muted-foreground">
            Loading compose file…
          </div>
        ) : composeContent ? (
          <ComposeViewer content={composeContent} />
        ) : (
          <p className="text-[12.5px] text-muted-foreground">No compose file stored yet.</p>
        )}
      </>
    );
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card px-4 py-6 text-center text-[12px] text-muted-foreground">
        Loading compose file…
      </div>
    );
  }
  if (composeContent == null) {
    return <p className="text-[12.5px] text-muted-foreground">No compose file stored yet.</p>;
  }
  // Mounts only once the content has loaded, so the editor seeds its draft from
  // the real YAML without an effect.
  return (
    <ComposeFileEditor
      projectId={projectId}
      resourceId={resourceId}
      initialContent={composeContent}
    />
  );
}

/** Read-only YAML viewer — transparent so it inherits the panel surface. */
function ComposeViewer({ content }: { content: string }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-background/40">
      <CodeMirror
        value={content}
        readOnly
        editable={false}
        theme="none"
        extensions={viewerExtensions}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
        }}
      />
    </div>
  );
}

/** Editable compose YAML for an inline stack. Saves via compose.updateContent,
 *  which re-parses + keeps the project manifest in lockstep; the change takes
 *  effect on the next redeploy. */
function ComposeFileEditor({
  projectId,
  resourceId,
  initialContent,
}: {
  projectId: string;
  resourceId: string;
  initialContent: string;
}) {
  const [draft, setDraft] = useState(initialContent);
  // Baseline the Save button dirties against — updated on a successful save so
  // the button settles without waiting for the invalidated query to refetch.
  const [baseline, setBaseline] = useState(initialContent);
  const dirty = draft !== baseline && draft.trim().length > 0;

  const save = useMutation({
    ...orpc.compose.updateContent.mutationOptions(),
    onSuccess: async (_data, variables) => {
      setBaseline(variables.composeContent);
      toast.success("Compose file saved", {
        description: "Redeploy the stack to apply your changes.",
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.compose.get.queryKey({
            input: { projectId, resourceId },
          }),
        }),
        // The graph card reads the parsed service summary off the resource list.
        queryClient.invalidateQueries({ queryKey: RESOURCE_COLLECTION_KEY }),
      ]);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to save compose file"),
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-lg border bg-background/40">
        <CodeMirror
          value={draft}
          theme="none"
          extensions={viewerExtensions}
          onChange={setDraft}
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="mr-auto text-[11px] text-muted-foreground">
          Edits take effect on the next redeploy.
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={!dirty || save.isPending}
          onClick={() => setDraft(baseline)}
        >
          Reset
        </Button>
        <Button
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate({
              projectId,
              resourceId,
              composeContent: draft,
            })
          }
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

export function ComposeSettingsTab({
  projectId,
  resourceId,
  name,
  serviceCount,
  onDelete,
  deleting,
}: {
  projectId: string;
  resourceId: string;
  name: string;
  serviceCount: number;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <>
      <div className="mb-4">
        <ComposeExposedEditor projectId={projectId} resourceId={resourceId} />
      </div>
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <div className="text-[13px] font-semibold text-destructive">Delete stack</div>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Removes every service in this stack from swarm, its routes, and the resource record. This
          can't be undone.
        </p>
        <TypedConfirmDialog
          trigger={
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="mt-3"
              disabled={deleting}
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
              {deleting ? "Deleting…" : "Delete stack"}
            </Button>
          }
          title={`Delete the ${name} stack?`}
          description={`All ${serviceCount} of its services are removed from swarm along with their routes and the resource record. This can't be undone.`}
          confirmPhrase={name}
          confirmLabel="Delete stack"
          pendingLabel="Deleting…"
          pending={deleting}
          onConfirm={onDelete}
        />
      </div>
    </>
  );
}

function ServiceRow({ service, status }: { service: ComposeService; status: StackServiceStatus }) {
  const meta = stackStatusMeta[status];
  // Task-derived "building" covers swarm's pre-running phases (pulling,
  // starting) — for an image-only service nothing builds, so say "Deploying".
  const label =
    status === "error" && service.hasBuild
      ? "Build failed"
      : status === "building" && !service.hasBuild
        ? "Deploying"
        : meta.label;
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-[14px] font-semibold text-card-foreground">
          {service.name}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
          <span className={cn("text-[12px] leading-none", meta.text)}>{label}</span>
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11.5px] text-muted-foreground">
        <span className="truncate">
          {service.image ?? (service.hasBuild ? "built from source" : "—")}
        </span>
        {service.ports.length > 0 && <span>· ports {service.ports.join(", ")}</span>}
      </div>
      {service.volumes.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {service.volumes.map((v) => (
            <span
              key={v}
              className="rounded-md bg-muted/60 px-1.5 py-1 font-mono text-[11px] leading-none text-muted-foreground"
            >
              {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
