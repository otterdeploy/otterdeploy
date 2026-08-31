// Variables editor with staged edits + bulk-edit dialog + per-row
// sensitive marking. Commits the whole diff in one bulkSet call so a 12
// line .env paste = one deployment, not twelve.

import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { useImperativeHandle, useMemo, useState, type Ref } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { RESOURCE_COLLECTION_KEY } from "@/features/resources/data/resource";
import { issueFor, type EnvSuggestion } from "@/features/resources/env-catalog";
import { orpc, queryClient } from "@/shared/server/orpc";

import { BulkEditDialog } from "./bulk-edit-dialog";
import { TableView } from "./table-view";
import { Toolbar } from "./toolbar";
import { useEditorState } from "./use-editor-state";

// Minimal shape the editor needs from any resource. Database + service
// rows both project into this: keeps the editor reusable across panels
// without dragging in the engine/databaseName/etc. fields the database
// view carries.
export interface VariablesEditorResource {
  projectId: ProjectId;
  resourceId: ResourceId;
  extraEnv: Record<string, string>;
  secretKeys: string[];
  /** Keys whose value is write-only. `extraEnv` holds "" for these: the
   *  server never sends a sealed value, so the editor shows them as
   *  replace-only rather than as an empty variable. */
  sealedKeys?: string[];
}

export interface VariablesEditorHandle {
  /** Append a blank row: driven by an external "New Variable" button. */
  addRow: () => void;
  /** Append a row pre-filled with a `${{Source.KEY}}` reference token:
   *  driven by the "Add a Variable Reference" hint banner. */
  insertReference: (token: string) => void;
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
  // Toolbar count label ("N User Variables"). Pass null when the surrounding
  // tab already renders its own count header. Otherwise the same rows get
  // counted twice under two different names (od-zh2.10).
  countLabel?: string | null;
  /** Known env vars for this resource's image (env catalog); enables the
   *  key-field autocomplete. Omit for resources with no known image. */
  suggestions?: EnvSuggestion[];
  /** Free-text filter from the surrounding tab's search box. Display only. */
  filter?: string;
  /** Show what each reference resolves to, under the row. Services only:
   *  `service.env.effective` is a service endpoint, and a database's env holds
   *  no references to resolve. Off by default so no surface calls it by
   *  accident. */
  showResolved?: boolean;
}

/** Suggest an env-var key from a picked `${{Source.KEY}}` token. The KEY
 *  segment when it looks like an env name, otherwise blank for the user. */
function suggestKeyFromToken(token: string): string {
  const match = /^\$\{\{[^.}]+\.([A-Z][A-Z0-9_]*)\}\}$/.exec(token);
  return match?.[1] ?? "";
}

export function VariablesEditor({
  resource,
  ref,
  onSave,
  countLabel,
  suggestions = [],
  filter = "",
  showResolved = false,
}: VariablesEditorProps) {
  const { t } = useTranslation();
  const [bulkOpen, setBulkOpen] = useState(false);

  // Tolerate undefined here: the resource list cache predates the
  // schema gaining extraEnv/secretKeys for services; without these
  // defaults `Object.entries(undefined)` in rowsFromServer throws and
  // takes out the whole panel.
  const editor = useEditorState({
    serverEnv: resource.extraEnv ?? {},
    serverSecretKeys: resource.secretKeys ?? [],
    serverSealedKeys: resource.sealedKeys ?? [],
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

  // What each `${{…}}` reference actually resolves to. Secret and sealed rows
  // come back masked (see routers/service/env-effective.ts), so this is safe to
  // hold in the browser. Only fetched where it means something.
  const effective = useQuery({
    ...orpc.service.env.effective.queryOptions({
      input: { projectId: resource.projectId, resourceId: resource.resourceId },
      staleTime: 15_000,
    }),
    enabled: showResolved,
  });
  const resolvedByKey = useMemo(
    () =>
      new Map(
        (effective.data ?? []).map((r) => [r.key, { value: r.value, unresolved: r.unresolved }]),
      ),
    [effective.data],
  );

  // Imperative handle for the header's "New Variable" button. Replaces the old
  // useRef+useEffect signal counter (an anti-pattern: it bumped a monotonic
  // prop through an effect purely to fire a local action). addRow is local
  // editor state, so this exposes it directly rather than round-tripping a prop.
  useImperativeHandle(
    ref,
    () => ({
      addRow: () => void editor.addRow(),
      insertReference: (token: string) =>
        void editor.addRow({ key: suggestKeyFromToken(token), value: token }),
    }),
    [editor],
  );

  const [stagingSave, setStagingSave] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const saveMut = useMutation(
    orpc.project.resource.env.bulkSet.mutationOptions({
      onSuccess: async () => {
        // The panel reads env from the react-db `resourceCollection`, whose
        // cache key is prefixed by RESOURCE_COLLECTION_KEY. Invalidating the
        // bare orpc list key (as before) never matched it, so the edit only
        // surfaced on the collection's 5s poll. Invalidate the collection so the
        // just-saved var appears at once.
        await queryClient.invalidateQueries({ queryKey: RESOURCE_COLLECTION_KEY });
        // Stamp the draft as saved so the ADDED/EDITED chips and Save/Discard
        // clear immediately: the refetch above returns the same values, so the
        // effect-driven re-baseline would otherwise skip (rows still "pending"
        // vs the OLD baseline) and the dirty state never cleared.
        editor.commit();
        // Saving persists only (redeploy: false): the values take effect the
        // next time the resource deploys (e.g. the panel's Redeploy action).
        // This is the FALLBACK path: services declared on the manifest save
        // via `onSave` staging instead, and their feedback is the pending-
        // changes bar plus the staged toast.
        toast.success(t("resources.variablesSavedRedeploy"));
      },
      onError: (err) => toast.error(err.message ?? t("resources.variablesSaveFailed")),
    }),
  );

  // Rows whose value fails a REQUIRED schema check. Same standing as a
  // duplicate key: saving would persist a value the app cannot start on.
  const blockingIssueCount = editor.rows.filter(
    (r) => !r.deleted && issueFor(suggestions, r.key, r.value)?.level === "block",
  ).length;

  /**
   * Apply ONE variable.
   *
   * `bulkSet` replaces the whole bag, so this sends every other row at its
   * SAVED value and only this row's edit (see payloadForRow) — otherwise
   * "apply this one" would quietly ship the rest of the draft too. Only the
   * applied row is re-baselined, so everything else stays pending.
   *
   * Not offered on the staged-manifest path: a manifest edit is applied as one
   * change through the pending-changes bar, and a per-row apply there would
   * mean a second, competing staging concept.
   */
  const applyRow = (id: string) => {
    const { env, secretKeys } = editor.payloadForRow(id);
    setApplyingId(id);
    applyOneMut.mutate(
      {
        projectId: resource.projectId,
        resourceId: resource.resourceId,
        env,
        secretKeys,
        redeploy: false,
      },
      {
        onSuccess: () => editor.commitRow(id),
        onSettled: () => setApplyingId(null),
      },
    );
  };

  const applyOneMut = useMutation(
    orpc.project.resource.env.bulkSet.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: RESOURCE_COLLECTION_KEY });
        toast.success(t("resources.variablesSavedRedeploy"));
      },
      onError: (err) => toast.error(err.message ?? t("resources.variablesSaveFailed")),
    }),
  );

  const save = () => {
    // Belt-and-braces behind the disabled Save button: env is keyed by name,
    // so a duplicate would silently drop all but one row server-side.
    if (editor.duplicateKeys.size > 0) return;
    if (blockingIssueCount > 0) return;
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
      // re-baselines the editor; commit() clears the pending chips right away
      // (see the live mutation's onSuccess). Errors already toast via the
      // stage mutation's own onError.
      setStagingSave(true);
      void onSave(env, secretKeys)
        .then(() => editor.commit())
        .catch(() => undefined)
        .finally(() => setStagingSave(false));
      return;
    }

    saveMut.mutate({
      projectId: resource.projectId,
      resourceId: resource.resourceId,
      env,
      secretKeys,
      // Persist only: a container's env is fixed at creation, so applying it
      // means recreating the task. Saving no longer forces that; the operator
      // hits Deploy when ready (the redeploy re-resolves env from these rows).
      redeploy: false,
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <Toolbar
        totalCount={editor.rows.length}
        countLabel={countLabel}
        hasPending={editor.hasPending}
        diff={editor.diff}
        duplicateCount={editor.duplicateKeys.size}
        blockingIssueCount={blockingIssueCount}
        saving={onSave ? stagingSave : saveMut.isPending}
        onBulkEdit={() => setBulkOpen(true)}
        onDiscard={editor.discard}
        onSave={save}
      />

      <TableView
        {...(showResolved ? { resolvedByKey } : {})}
        rows={editor.rows}
        deletedRows={editor.deletedRows}
        projectId={resource.projectId}
        duplicateKeys={editor.duplicateKeys}
        suggestions={suggestions}
        statusOf={editor.statusOf}
        onUpdate={editor.update}
        onDelete={editor.removeRow}
        onRestore={editor.restoreRow}
        onAddRow={() => editor.addRow()}
        filter={filter}
        {...(onSave ? {} : { onApplyRow: applyRow, onRevertRow: editor.revertRow })}
        applyingId={applyingId}
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
