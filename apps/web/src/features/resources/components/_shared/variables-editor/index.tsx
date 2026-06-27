// Variables editor with staged edits + bulk-edit dialog + per-row
// sensitive marking. Commits the whole diff in one bulkSet call so a 12
// line .env paste = one deployment, not twelve.

import { useEffect, useRef, useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

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
  projectId: string;
  resourceId: string;
  extraEnv: Record<string, string>;
  secretKeys: string[];
}

interface VariablesEditorProps {
  resource: VariablesEditorResource;
  // Bumped by the tab header's "New Variable" button — when it advances
  // the editor adds an empty row.
  addRowSignal?: number;
  // Override persistence. Default = the live-resource `env.bulkSet` mutation.
  // A pending-create resource has no resourceId yet, so it passes a handler
  // that stages the env onto its manifest entry instead. Secret keys are
  // forwarded but the manifest path ignores them (manifest env is plaintext).
  onSave?: (env: Array<{ key: string; value: string }>, secretKeys: string[]) => Promise<void>;
}

export function VariablesEditor({ resource, addRowSignal = 0, onSave }: VariablesEditorProps) {
  const [bulkOpen, setBulkOpen] = useState(false);

  // Tolerate undefined here — the resource list cache predates the
  // schema gaining extraEnv/secretKeys for services; without these
  // defaults `Object.entries(undefined)` in rowsFromServer throws and
  // takes out the whole panel.
  const editor = useEditorState({
    serverEnv: resource.extraEnv ?? {},
    serverSecretKeys: resource.secretKeys ?? [],
  });

  const lastAddSignal = useRef(0);
  useEffect(() => {
    if (addRowSignal > lastAddSignal.current) {
      lastAddSignal.current = addRowSignal;
      editor.addRow();
    }
    // editor.addRow is stable enough for this single-shot effect — it's
    // recreated each render but we only consult it when the signal advances.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addRowSignal]);

  const [stagingSave, setStagingSave] = useState(false);
  const saveMut = useMutation(
    orpc.project.resource.env.bulkSet.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: orpc.project.resource.list.queryKey({
            input: { projectId: resource.projectId as never },
          }),
        });
        toast.success("Variables saved — service redeploying");
      },
      onError: (err) => toast.error(err.message ?? "Failed to save"),
    }),
  );

  const save = () => {
    // Drop empty-keyed rows here rather than at the server so the operator
    // sees the row disappear instead of a silent server-side filter.
    const env = editor.rows
      .filter((r) => r.key.trim().length > 0)
      .map((r) => ({ key: r.key.trim(), value: r.value }));
    const secretKeys = editor.rows
      .filter((r) => r.isSecret && r.key.trim().length > 0)
      .map((r) => r.key.trim());

    if (onSave) {
      // Staging invalidates the manifest query, which re-feeds serverEnv and
      // re-baselines the editor — same refresh path as the live mutation.
      setStagingSave(true);
      void onSave(env, secretKeys).finally(() => setStagingSave(false));
      return;
    }

    saveMut.mutate({
      projectId: resource.projectId as never,
      resourceId: resource.resourceId as never,
      env,
      secretKeys,
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
