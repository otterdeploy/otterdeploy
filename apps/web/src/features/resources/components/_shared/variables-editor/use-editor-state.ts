// Draft state for the variables editor. Tracks per-row status
// (unchanged / added / edited / deleted) vs. the server snapshot so
// "Save" can commit the whole diff in one bulkSet and "Discard" can
// revert to the snapshot.

import { useEffect, useRef, useState } from "react";

export type RowStatus = "unchanged" | "added" | "edited" | "deleted";

interface EnvEntry {
  key: string;
  value: string;
}

export interface DraftRow {
  // Stable across the row's lifetime so React keys + cursor focus survive
  // edits. Distinct from `key` (the env var name) which the user can rename.
  id: string;
  key: string;
  value: string;
  isSecret: boolean;
  /** Write-only: the server never sent a value for this row, and never will.
   *  It can be replaced or deleted, not read. Set from the resource's
   *  `sealedKeys`; a row added in this draft is never sealed. */
  sealed: boolean;
  // The server-side state we're diffing against. Null when this row was
  // added in the current draft.
  baseline: { key: string; value: string; isSecret: boolean } | null;
  // Deleted rows are kept in state so an undo / save can re-include them;
  // table mode hides them but the diff still considers them.
  deleted: boolean;
}

interface UseEditorStateArgs {
  serverEnv: Record<string, string>;
  serverSecretKeys: string[];
  serverSealedKeys?: string[];
}

function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function rowsFromServer(
  env: Record<string, string>,
  secretKeys: string[],
  sealedKeys: string[] = [],
): DraftRow[] {
  const secretSet = new Set(secretKeys);
  const sealedSet = new Set(sealedKeys);
  return Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      const isSecret = secretSet.has(key);
      return {
        id: rid(),
        key,
        value,
        isSecret,
        sealed: sealedSet.has(key),
        baseline: { key, value, isSecret },
        deleted: false,
      };
    });
}

/**
 * The env bag to send when applying ONE row.
 *
 * `bulkSet` replaces the whole bag, so a single-row apply cannot send just that
 * row: it sends every OTHER row at its SAVED value, with only this row carrying
 * its edit. That is what makes "apply this one variable" mean what it says
 * instead of quietly shipping the rest of the draft too.
 *
 * Pure and exported: this is the part where a mistake is silent and
 * destructive, so it is pinned by tests rather than exercised through a render.
 */
export function payloadForRowFrom(
  rows: DraftRow[],
  id: string,
): { env: EnvEntry[]; secretKeys: string[] } {
  const env: EnvEntry[] = [];
  const secretKeys: string[] = [];
  for (const r of rows) {
    const isTarget = r.id === id;
    // The target's delete is what we are applying, so it contributes nothing.
    // Another row's pending delete is NOT being applied, so its saved value
    // stands.
    if (r.deleted && isTarget) continue;
    const source = isTarget ? r : (r.baseline ?? r);
    const key = source.key.trim();
    if (!key) continue;
    // A row added in this draft has no saved value, so someone else's apply
    // must not introduce it.
    if (!isTarget && !r.baseline) continue;
    env.push({ key, value: source.value });
    if (source.isSecret) secretKeys.push(key);
  }
  return { env, secretKeys };
}

function statusOf(row: DraftRow): RowStatus {
  if (row.deleted) return "deleted";
  if (!row.baseline) return "added";
  if (
    row.key !== row.baseline.key ||
    row.value !== row.baseline.value ||
    row.isSecret !== row.baseline.isSecret
  ) {
    return "edited";
  }
  return "unchanged";
}

export function useEditorState({
  serverEnv,
  serverSecretKeys,
  serverSealedKeys,
}: UseEditorStateArgs) {
  const [rows, setRows] = useState<DraftRow[]>(() =>
    rowsFromServer(serverEnv, serverSecretKeys, serverSealedKeys),
  );

  // Re-baseline when the server snapshot changes AND we have no pending
  // edits: otherwise an unrelated invalidate would clobber the operator's
  // in-progress draft.
  const lastServerKey = useRef("");
  const snapshotKey = JSON.stringify({ serverEnv, serverSecretKeys, serverSealedKeys });
  useEffect(() => {
    if (snapshotKey === lastServerKey.current) return;
    lastServerKey.current = snapshotKey;
    setRows((prev) => {
      const hasPending = prev.some((r) => statusOf(r) !== "unchanged");
      if (hasPending) return prev;
      return rowsFromServer(serverEnv, serverSecretKeys, serverSealedKeys);
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

  const discard = () => setRows(rowsFromServer(serverEnv, serverSecretKeys, serverSealedKeys));

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
   *  row's chip clears and the rest of the draft stays pending. */
  const commitRow = (id: string) =>
    setRows((prev) =>
      prev.flatMap((r) => {
        if (r.id !== id) return [r];
        if (r.deleted) return [];
        return [{ ...r, baseline: { key: r.key, value: r.value, isSecret: r.isSecret } }];
      }),
    );

  const payloadForRow = (id: string) => payloadForRowFrom(rows, id);

  // Stamp the current draft as the new baseline, called after a successful
  // save so ADDED/EDITED chips, the "N added" badge and Save/Discard clear
  // immediately. The refetch that follows the save's invalidation re-baselines
  // to the identical server snapshot (the effect above sees no pending rows),
  // so this never fights the server state.
  const commit = () =>
    setRows((prev) =>
      prev
        .filter((r) => !r.deleted)
        .map((r) => ({
          ...r,
          baseline: { key: r.key, value: r.value, isSecret: r.isSecret },
        })),
    );

  // Bulk replace, used by Raw mode commit and Paste dialog merge.
  // Preserves baselines for keys that already existed so the per-row
  // status pill still tells the truth.
  const replaceAll = (next: { key: string; value: string; isSecret: boolean }[]) =>
    setRows((prev) => {
      const baselineByKey = new Map<string, NonNullable<DraftRow["baseline"]>>();
      for (const r of prev) {
        if (r.baseline) baselineByKey.set(r.baseline.key, r.baseline);
      }
      const idByKey = new Map<string, string>();
      for (const r of prev) {
        if (!r.deleted) idByKey.set(r.key, r.id);
      }
      // Consume id/baseline on first use: a pasted .env can repeat a key, and
      // reusing the same id for both rows would collide React keys and make
      // update() patch them in lockstep. The second occurrence becomes a fresh
      // "added" row, which the duplicate-key flag then surfaces.
      return next.map((e) => {
        const id = idByKey.get(e.key);
        if (id) idByKey.delete(e.key);
        const baseline = baselineByKey.get(e.key);
        if (baseline) baselineByKey.delete(e.key);
        return {
          id: id ?? rid(),
          key: e.key,
          value: e.value,
          isSecret: e.isSecret,
          // Bulk-edit text carries no sealed rows: the server drops any entry
          // colliding with a sealed key (bulkReplaceServiceEnvVars).
          sealed: false,
          baseline: baseline ?? null,
          deleted: false,
        };
      });
    });

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
  };
}
