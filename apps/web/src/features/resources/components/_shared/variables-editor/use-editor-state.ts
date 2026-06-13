// Draft state for the variables editor. Tracks per-row status
// (unchanged / added / edited / deleted) vs. the server snapshot so
// "Save" can commit the whole diff in one bulkSet and "Discard" can
// revert to the snapshot.

import { useEffect, useMemo, useRef, useState } from "react";

export type RowStatus = "unchanged" | "added" | "edited" | "deleted";

export interface DraftRow {
  // Stable across the row's lifetime so React keys + cursor focus survive
  // edits. Distinct from `key` (the env var name) which the user can rename.
  id: string;
  key: string;
  value: string;
  isSecret: boolean;
  // The server-side state we're diffing against — null when this row was
  // added in the current draft.
  baseline: { key: string; value: string; isSecret: boolean } | null;
  // Deleted rows are kept in state so an undo / save can re-include them;
  // table mode hides them but the diff still considers them.
  deleted: boolean;
}

interface UseEditorStateArgs {
  serverEnv: Record<string, string>;
  serverSecretKeys: string[];
}

function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function rowsFromServer(
  env: Record<string, string>,
  secretKeys: string[],
): DraftRow[] {
  const secretSet = new Set(secretKeys);
  return Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      const isSecret = secretSet.has(key);
      return {
        id: rid(),
        key,
        value,
        isSecret,
        baseline: { key, value, isSecret },
        deleted: false,
      };
    });
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
}: UseEditorStateArgs) {
  const [rows, setRows] = useState<DraftRow[]>(() =>
    rowsFromServer(serverEnv, serverSecretKeys),
  );

  // Re-baseline when the server snapshot changes AND we have no pending
  // edits — otherwise an unrelated invalidate would clobber the operator's
  // in-progress draft.
  const lastServerKey = useRef("");
  const snapshotKey = useMemo(
    () => JSON.stringify({ serverEnv, serverSecretKeys }),
    [serverEnv, serverSecretKeys],
  );
  useEffect(() => {
    if (snapshotKey === lastServerKey.current) return;
    lastServerKey.current = snapshotKey;
    setRows((prev) => {
      const hasPending = prev.some((r) => statusOf(r) !== "unchanged");
      if (hasPending) return prev;
      return rowsFromServer(serverEnv, serverSecretKeys);
    });
  }, [snapshotKey, serverEnv, serverSecretKeys]);

  const update = (id: string, patch: Partial<Pick<DraftRow, "key" | "value" | "isSecret">>) =>
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );

  const addRow = (seed?: Partial<DraftRow>): string => {
    const id = rid();
    setRows((prev) => [
      ...prev,
      {
        id,
        key: seed?.key ?? "",
        value: seed?.value ?? "",
        isSecret: seed?.isSecret ?? false,
        baseline: null,
        deleted: false,
      },
    ]);
    return id;
  };

  const removeRow = (id: string) =>
    setRows((prev) =>
      prev
        // Added-then-removed rows leave no trace; existing rows tombstone
        // until save so undo works.
        .map((r) => (r.id === id ? { ...r, deleted: true } : r))
        .filter((r) => !(r.deleted && r.baseline === null)),
    );

  const restoreRow = (id: string) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, deleted: false } : r)));

  const discard = () => setRows(rowsFromServer(serverEnv, serverSecretKeys));

  // Bulk replace — used by Raw mode commit and Paste dialog merge.
  // Preserves baselines for keys that already existed so the per-row
  // status pill still tells the truth.
  const replaceAll = (next: { key: string; value: string; isSecret: boolean }[]) =>
    setRows((prev) => {
      const baselineByKey = new Map<string, NonNullable<DraftRow["baseline"]>>();
      for (const r of prev) {
        if (r.baseline) baselineByKey.set(r.baseline.key, r.baseline);
      }
      const idByKey = new Map(
        prev
          .filter((r) => !r.deleted)
          .map((r) => [r.key, r.id] as const),
      );
      return next.map((e) => ({
        id: idByKey.get(e.key) ?? rid(),
        key: e.key,
        value: e.value,
        isSecret: e.isSecret,
        baseline: baselineByKey.get(e.key) ?? null,
        deleted: false,
      }));
    });

  const visible = rows.filter((r) => !r.deleted);
  const deleted = rows.filter((r) => r.deleted && r.baseline !== null);
  const diff = useMemo(() => {
    const added = rows.filter((r) => !r.deleted && !r.baseline).length;
    const edited = rows.filter(
      (r) => !r.deleted && r.baseline && statusOf(r) === "edited",
    ).length;
    return { added, edited, deleted: deleted.length };
  }, [rows, deleted.length]);
  const hasPending = diff.added + diff.edited + diff.deleted > 0;

  return {
    rows: visible,
    deletedRows: deleted,
    diff,
    hasPending,
    statusOf,
    update,
    addRow,
    removeRow,
    restoreRow,
    discard,
    replaceAll,
  };
}
