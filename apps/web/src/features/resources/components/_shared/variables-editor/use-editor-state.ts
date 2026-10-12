// Draft state for the variables editor. Tracks per-row status
// (unchanged / added / edited / deleted) vs. the server snapshot so
// "Save" can commit the whole diff in one bulkSet and "Discard" can
// revert to the snapshot.

import { useEffect, useRef, useState } from "react";

import {
  type DraftRow,
  type EnvEntry,
  type UseEditorStateArgs,
  payloadForRowFrom,
  rebaseRows,
  replaceAllRows,
  rid,
  rowsFromServer,
  serverSnapshotVersion,
  statusOf,
  versionAfterSave,
} from "./draft-rows";

export type { DraftRow, RowStatus } from "./draft-rows";
export {
  payloadForRowFrom,
  rebaseRows,
  serverSnapshotVersion,
  versionAfterSave,
} from "./draft-rows";

export function useEditorState({
  serverEnv,
  serverSecretKeys,
  serverSealedKeys,
}: UseEditorStateArgs) {
  // The draft and the version of the server set its baselines came from. A
  // save names that version, so a set another tab changed since is refused
  // instead of silently replaced. One state so they never drift.
  const [draft, setDraft] = useState<{ rows: DraftRow[]; loadedVersion: string }>(() => ({
    rows: rowsFromServer(serverEnv, serverSecretKeys, serverSealedKeys),
    loadedVersion: serverSnapshotVersion(serverEnv, serverSecretKeys, serverSealedKeys),
  }));
  const rows = draft.rows;
  const setRows = (next: (prev: DraftRow[]) => DraftRow[]) =>
    setDraft((prev) => ({ ...prev, rows: next(prev.rows) }));

  // Re-baseline when the server snapshot changes AND we have no pending
  // edits: otherwise an unrelated invalidate would clobber the operator's
  // in-progress draft. With pending edits the loaded version stays put, which
  // is exactly what makes a save from a stale draft a conflict.
  const lastServerKey = useRef("");
  const snapshotKey = JSON.stringify({ serverEnv, serverSecretKeys, serverSealedKeys });
  useEffect(() => {
    if (snapshotKey === lastServerKey.current) return;
    lastServerKey.current = snapshotKey;
    setDraft((prev) => {
      const hasPending = prev.rows.some((r) => statusOf(r) !== "unchanged");
      if (hasPending) return prev;
      return {
        rows: rowsFromServer(serverEnv, serverSecretKeys, serverSealedKeys),
        loadedVersion: serverSnapshotVersion(serverEnv, serverSecretKeys, serverSealedKeys),
      };
    });
  }, [snapshotKey, serverEnv, serverSecretKeys, serverSealedKeys]);

  const update = (id: string, patch: Partial<Pick<DraftRow, "key" | "value" | "isSecret">>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const addRow = (seed?: Partial<DraftRow>): string => {
    const id = rid();
    setRows((prev) => [
      ...prev,
      {
        id,
        key: seed?.key ?? "",
        value: seed?.value ?? "",
        isSecret: seed?.isSecret ?? false,
        // A row typed in this draft has a plaintext value the client holds;
        // sealing happens server-side, never here.
        sealed: false,
        baseline: null,
        deleted: false,
      },
    ]);
    return id;
  };

  const removeRow = (id: string) =>
    setRows((prev) =>
      prev.reduce<DraftRow[]>((acc, r) => {
        // Added-then-removed rows leave no trace; existing rows tombstone
        // until save so undo works.
        const next = r.id === id ? { ...r, deleted: true } : r;
        if (!(next.deleted && next.baseline === null)) acc.push(next);
        return acc;
      }, []),
    );

  const restoreRow = (id: string) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, deleted: false } : r)));

  const discard = () =>
    setDraft({
      rows: rowsFromServer(serverEnv, serverSecretKeys, serverSealedKeys),
      loadedVersion: serverSnapshotVersion(serverEnv, serverSecretKeys, serverSealedKeys),
    });

  /** Reload to merge: re-base the draft on the current server snapshot. */
  const rebase = () =>
    setDraft((prev) => ({
      rows: rebaseRows(prev.rows, rowsFromServer(serverEnv, serverSecretKeys, serverSealedKeys)),
      loadedVersion: serverSnapshotVersion(serverEnv, serverSecretKeys, serverSealedKeys),
    }));

  /** Undo ONE row back to the server snapshot. An added row disappears; a
   *  tombstoned one comes back; an edited one returns to its baseline. */
  const revertRow = (id: string) =>
    setRows((prev) =>
      prev.flatMap((r) => {
        if (r.id !== id) return [r];
        if (!r.baseline) return [];
        return [{ ...r, ...r.baseline, deleted: false }];
      }),
    );

  /** Stamp ONE row as saved. Called after a single-row apply so only that
   *  row's chip clears and the rest of the draft stays pending.
   *  `savedVersion` is the set's version after that apply (versionAfterSave). */
  const commitRow = (id: string, savedVersion: string) =>
    setDraft((prev) => ({
      loadedVersion: savedVersion,
      rows: prev.rows.flatMap((r) => {
        if (r.id !== id) return [r];
        if (r.deleted) return [];
        return [{ ...r, baseline: { key: r.key, value: r.value, isSecret: r.isSecret } }];
      }),
    }));

  const payloadForRow = (id: string) => payloadForRowFrom(rows, id);

  // Stamp the current draft as the new baseline, called after a successful
  // save so ADDED/EDITED chips, the "N added" badge and Save/Discard clear
  // immediately. The refetch that follows the save's invalidation re-baselines
  // to the identical server snapshot (the effect above sees no pending rows),
  // so this never fights the server state.
  const commit = (savedVersion?: string) =>
    setDraft((prev) => ({
      loadedVersion: savedVersion ?? prev.loadedVersion,
      rows: prev.rows
        .filter((r) => !r.deleted)
        .map((r) => ({
          ...r,
          baseline: { key: r.key, value: r.value, isSecret: r.isSecret },
        })),
    }));

  /** The set's version once a save of `env` lands; see versionAfterSave. */
  const savedVersionFor = (env: EnvEntry[], secretKeys: string[]) =>
    versionAfterSave(rows, env, secretKeys);

  // Bulk replace, used by Raw mode commit and Paste dialog merge.
  const replaceAll = (next: { key: string; value: string; isSecret: boolean }[]) =>
    setRows((prev) => replaceAllRows(prev, next));

  const visible = rows.filter((r) => !r.deleted);
  const deleted = rows.filter((r) => r.deleted && r.baseline !== null);
  const added = rows.filter((r) => !r.deleted && !r.baseline).length;
  const edited = rows.filter((r) => !r.deleted && r.baseline && statusOf(r) === "edited").length;
  const diff = { added, edited, deleted: deleted.length };
  const hasPending = diff.added + diff.edited + diff.deleted > 0;

  // Keys (trimmed) carried by more than one visible row. Save is blocked
  // while any exist: bulkSet keys env by name, so one row would silently
  // overwrite the other and which survives is serialization luck.
  const keyCounts = new Map<string, number>();
  for (const r of visible) {
    const k = r.key.trim();
    if (k) keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
  }
  const duplicateKeys = new Set<string>();
  for (const [k, n] of keyCounts) {
    if (n > 1) duplicateKeys.add(k);
  }

  return {
    rows: visible,
    deletedRows: deleted,
    diff,
    hasPending,
    duplicateKeys,
    statusOf,
    update,
    addRow,
    removeRow,
    restoreRow,
    discard,
    replaceAll,
    commit,
    revertRow,
    commitRow,
    payloadForRow,
    rebase,
    savedVersionFor,
    /** The version of the server set this draft was built from. */
    loadedVersion: draft.loadedVersion,
  };
}
