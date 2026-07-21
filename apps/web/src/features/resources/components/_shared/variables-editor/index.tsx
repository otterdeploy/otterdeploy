// Variables editor with staged edits + bulk-edit dialog + per-row
// sensitive marking. Commits the whole diff in one bulkSet call so a 12
// line .env paste = one deployment, not twelve.

import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";
import { useImperativeHandle, useState, type Ref } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { RESOURCE_COLLECTION_KEY } from "@/features/resources/data/resource";
import { orpc, queryClient } from "@/shared/server/orpc";

import { BulkEditDialog } from "./bulk-edit-dialog";
import { TableView } from "./table-view";
import { Toolbar } from "./toolbar";
import { useEditorState } from "./use-editor-state";

// Minimal shape the editor needs from any resource. Database + service
// rows both project into this — keeps the editor reusable across panels
// without dragging in the engine/databaseName/etc. fields the database
// view carries.
export interface VariablesEditorResource {
  projectId: ProjectId;
  resourceId: ResourceId;
  extraEnv: Record<string, string>;
  secretKeys: string[];
}

export interface VariablesEditorHandle {
  /** Append a blank row — driven by an external "New Variable" button. */
  addRow: () => void;
}

interface VariablesEditorProps {
  resource: VariablesEditorResource;
  // Imperative handle for the tab header's "New Variable" button to add a row.
  ref?: Ref<VariablesEditorHandle>;
  // Override persistence. Default = the live-resource `env.bulkSet` mutation.
  // A pending-create resource has no resourceId yet, so it passes a handler
  // that stages the env onto its manifest entry instead. Secret keys are
  // forwarded but the manifest path ignores them (manifest env is plaintext).
  onSave?: (env: Array<{ key: string; value: string }>, secretKeys: string[]) => Promise<void>;
}

export function VariablesEditor({ resource, ref, onSave }: VariablesEditorProps) {
  const [bulkOpen, setBulkOpen] = useState(false);

  // Tolerate undefined here — the resource list cache predates the
  // schema gaining extraEnv/secretKeys for services; without these
  // defaults `Object.entries(undefined)` in rowsFromServer throws and
  // takes out the whole panel.
  const editor = useEditorState({
    serverEnv: resource.extraEnv ?? {},
    serverSecretKeys: resource.secretKeys ?? [],
  });

  // Warm the reference list once for the whole editor so a row's { } picker
  // opens instantly. Each row's ReferencePicker reads the same query key, so
  // it hits this cache instead of firing (and spinning) on first click.
  useQuery(
    orpc.project.refs.list.queryOptions({
      input: { projectId: resource.projectId },
      staleTime: 30_000,
    }),
  );

  // Imperative handle for the header's "New Variable" button — replaces the old
  // useRef+useEffect signal counter (an anti-pattern: it bumped a monotonic
  // prop through an effect purely to fire a local action). addRow is local
  // editor state, so this exposes it directly rather than round-tripping a prop.
  useImperativeHandle(ref, () => ({ addRow: () => void editor.addRow() }), [editor]);

  const [stagingSave, setStagingSave] = useState(false);
  const saveMut = useMutation(
    orpc.project.resource.env.bulkSet.mutationOptions({
      onSuccess: async () => {
        // The panel reads env from the react-db `resourceCollection`, whose
        // cache key is prefixed by RESOURCE_COLLECTION_KEY — invalidating the
        // bare orpc list key (as before) never matched it, so the edit only
        // surfaced on the collection's 5s poll. Invalidate the collection so the
        // just-saved var appears at once.
        await queryClient.invalidateQueries({ queryKey: RESOURCE_COLLECTION_KEY });
        toast.success("Variables saved — Deploy to apply");
      },
      onError: (err) => toast.error(err.message ?? "Failed to save"),
    }),
  );

  const save = () => {
    // Drop empty-keyed rows here rather than at the server so the operator
    // sees the row disappear instead of a silent server-side filter.
    const env = editor.rows.flatMap((r) =>
      r.key.trim().length > 0 ? [{ key: r.key.trim(), value: r.value }] : [],
    );
    const secretKeys = editor.rows.flatMap((r) =>
      r.isSecret && r.key.trim().length > 0 ? [r.key.trim()] : [],
    );

    if (onSave) {
      // Staging invalidates the manifest query, which re-feeds serverEnv and
      // re-baselines the editor — same refresh path as the live mutation.
      setStagingSave(true);
      void onSave(env, secretKeys).finally(() => setStagingSave(false));
      return;
    }

    saveMut.mutate({
      projectId: resource.projectId,
      resourceId: resource.resourceId,
      env,
      secretKeys,
      // Persist only — a container's env is fixed at creation, so applying it
      // means recreating the task. Saving no longer forces that; the operator
      // hits Deploy when ready (the redeploy re-resolves env from these rows).
      redeploy: false,
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <Toolbar
        totalCount={editor.rows.length}
        hasPending={editor.hasPending}
        diff={editor.diff}
        saving={onSave ? stagingSave : saveMut.isPending}
        onBulkEdit={() => setBulkOpen(true)}
        onDiscard={editor.discard}
        onSave={save}
      />

      <TableView
        rows={editor.rows}
        deletedRows={editor.deletedRows}
        projectId={resource.projectId}
        statusOf={editor.statusOf}
        onUpdate={editor.update}
        onDelete={editor.removeRow}
        onRestore={editor.restoreRow}
        onAddRow={() => editor.addRow()}
      />

      <BulkEditDialog
        open={bulkOpen}
        rows={editor.rows}
        onClose={() => setBulkOpen(false)}
        onApply={editor.replaceAll}
      />
    </div>
  );
}
