// Pure draft-row logic for the variables editor: the row model, its status
// against the server snapshot, and the payload / version / re-base helpers.
// Split from use-editor-state.ts (size); the hook owns only React state.

import { envSetVersion } from "@otterdeploy/shared/env-version";

export type RowStatus = "unchanged" | "added" | "edited" | "deleted";

export interface EnvEntry {
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

export interface UseEditorStateArgs {
  serverEnv: Record<string, string>;
  serverSecretKeys: string[];
  serverSealedKeys?: string[];
}

export function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function rowsFromServer(
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

/** The version (envSetVersion) of the set the server snapshot describes. */
export function serverSnapshotVersion(
  env: Record<string, string>,
  secretKeys: string[],
  sealedKeys: string[] = [],
): string {
  const secretSet = new Set(secretKeys);
  const sealedSet = new Set(sealedKeys);
  return envSetVersion(
    Object.entries(env).map(([key, value]) => ({
      key,
      value,
      isSecret: secretSet.has(key),
      sealed: sealedSet.has(key),
    })),
  );
}

/**
 * The version the server's set has once a save of `env` lands: the sent
 * entries, except that a key colliding with a sealed row is dropped and the
 * sealed row kept (bulkReplaceServiceEnvVars never touches a sealed row).
 * Pure and exported so the editor's bookkeeping after a save is pinned.
 */
export function versionAfterSave(rows: DraftRow[], env: EnvEntry[], secretKeys: string[]): string {
  const sealed = rows.filter((r) => r.sealed && r.baseline);
  const sealedKeys = new Set(sealed.map((r) => r.baseline?.key ?? r.key));
  const secretSet = new Set(secretKeys);
  return envSetVersion([
    ...env
      .filter((e) => !sealedKeys.has(e.key.trim()))
      .map((e) => ({ ...e, isSecret: secretSet.has(e.key.trim()) })),
    ...sealed.map((r) => ({
      key: r.baseline?.key ?? r.key,
      value: "",
      isSecret: r.baseline?.isSecret ?? r.isSecret,
      sealed: true,
    })),
  ]);
}

/**
 * "Reload to merge": re-base a draft onto a fresh server snapshot, keeping
 * every edit the operator made. Rows they did not touch take the server's
 * current value (that is the other tab's work); an edited row becomes an edit
 * of the server's current row with the same saved key (or an added row, if the
 * other tab deleted it); an added row becomes an edit when the other tab added
 * the same key; a deleted row stays deleted when it still exists.
 *
 * Pure and exported: a mistake here is a silent loss of someone's variable.
 */
export function rebaseRows(draft: DraftRow[], fresh: DraftRow[]): DraftRow[] {
  const next = fresh.map((r) => ({ ...r }));
  const bySavedKey = new Map(next.map((r) => [r.key, r]));
  for (const r of draft) {
    const status = statusOf(r);
    if (status === "unchanged") continue;
    const savedKey = r.baseline?.key ?? r.key;
    const current = bySavedKey.get(savedKey);
    if (status === "deleted") {
      if (current) current.deleted = true;
      continue;
    }
    if (current && !current.deleted) {
      // Same saved key on the server now: the operator's edit applies to it.
      current.id = r.id;
      current.key = r.key;
      current.value = r.value;
      current.isSecret = r.isSecret;
      continue;
    }
    next.push({ ...r, sealed: false, baseline: null, deleted: false });
  }
  return next;
}

export function statusOf(row: DraftRow): RowStatus {
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

/**
 * Bulk replace, used by Raw mode commit and Paste dialog merge. Preserves
 * baselines for keys that already existed so the per-row status pill still
 * tells the truth.
 */
export function replaceAllRows(
  prev: DraftRow[],
  next: { key: string; value: string; isSecret: boolean }[],
): DraftRow[] {
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
}

/**
 * The bag a full Save sends: every visible row, empty keys dropped here (so
 * the operator sees the row disappear instead of a silent server-side
 * filter), keys trimmed.
 */
export function savePayloadFrom(rows: DraftRow[]): { env: EnvEntry[]; secretKeys: string[] } {
  const named = rows.filter((r) => !r.deleted && r.key.trim().length > 0);
  return {
    env: named.map((r) => ({ key: r.key.trim(), value: r.value })),
    secretKeys: named.filter((r) => r.isSecret).map((r) => r.key.trim()),
  };
}
