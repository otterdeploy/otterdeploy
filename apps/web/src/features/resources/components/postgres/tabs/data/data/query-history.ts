/**
 * SQL-console execution history — a per-database localStorage ring of the last
 * {@link HISTORY_LIMIT} statements the user ran (successes AND failures), for
 * the toolbar's History popover. Browser-local like the snippet store; nothing
 * here touches the server. The ring math is pure (tested); the hook wraps it
 * with storage + state.
 */

import { useCallback, useState } from "react";

export const HISTORY_LIMIT = 50;

export interface QueryHistoryEntry {
  id: string;
  sql: string;
  /** Did the statement run without error? */
  ok: boolean;
  /** Returned/affected rows (null when the run failed). */
  rowCount: number | null;
  /** Wall-clock duration (null when the run failed before timing). */
  durationMs: number | null;
  /** Failure reason (null on success). */
  error: string | null;
  /** Epoch ms. */
  at: number;
}

/** Prepend `entry`, cap at {@link HISTORY_LIMIT} (newest first). Re-running a
 *  statement records a NEW entry — history is a log, not a set. */
export function pushHistory(
  entries: QueryHistoryEntry[],
  entry: QueryHistoryEntry,
): QueryHistoryEntry[] {
  return [entry, ...entries].slice(0, HISTORY_LIMIT);
}

const storageKey = (resourceId: string) => `otter:sql-history:${resourceId}`;

function loadHistory(resourceId: string): QueryHistoryEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(resourceId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as QueryHistoryEntry[]).slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function saveHistory(resourceId: string, entries: QueryHistoryEntry[]) {
  try {
    localStorage.setItem(storageKey(resourceId), JSON.stringify(entries));
  } catch {
    /* storage full / unavailable — history is best-effort */
  }
}

/** The console's execution log for one database. `record` appends and persists. */
export function useQueryHistory(resourceId: string) {
  const [entries, setEntries] = useState<QueryHistoryEntry[]>(() => loadHistory(resourceId));

  const record = useCallback(
    (e: Omit<QueryHistoryEntry, "id" | "at">) => {
      setEntries((prev) => {
        const next = pushHistory(prev, { ...e, id: crypto.randomUUID(), at: Date.now() });
        saveHistory(resourceId, next);
        return next;
      });
    },
    [resourceId],
  );

  const clear = useCallback(() => {
    setEntries([]);
    saveHistory(resourceId, []);
  }, [resourceId]);

  return { entries, record, clear };
}
