/**
 * Unsaved bulk-edit drafts for the Variables page, persisted per
 * (project, environment) in a localStorage-backed TanStack DB collection so
 * a reload (or an accidental tab close) doesn't eat what the operator
 * typed. Cross-tab synced by the storage event (built into the collection).
 *
 * A draft exists only while the editor's text differs from the saved rows:
 * typing writes it through, matching the pristine text deletes it, and a
 * successful apply deletes it. Server state never lives here.
 */

import { createCollection, localStorageCollectionOptions } from "@tanstack/db";

export interface VariableDraft {
  /** `${projectId}:${environmentId}`: one draft per env editor. */
  id: string;
  projectId: string;
  environmentId: string;
  text: string;
  updatedAt: number;
  /** The saved set this draft started from: its version (envSetVersion), so
   *  applying the draft names it and a set changed since is refused instead of
   *  replaced, and its text, so "Reload to merge" knows which
   *  lines the operator changed. Absent on drafts written before this. */
  baseVersion?: string;
  baseText?: string;
}

export const variableDraftId = (projectId: string, environmentId: string): string =>
  `${projectId}:${environmentId}`;

export const variableDraftsCollection = createCollection(
  localStorageCollectionOptions({
    id: "variable-drafts",
    storageKey: "otterdeploy.variable-drafts",
    getKey: (draft: VariableDraft) => draft.id,
  }),
);

/** Write-through helper: upsert while dirty, drop when back to pristine. */
export function setVariableDraft(input: {
  projectId: string;
  environmentId: string;
  text: string;
  pristine: string;
  /** The saved set the editor loaded. Recorded when the draft starts; only
   *  replaced when `rebase` is set (after "Reload to merge"). */
  base?: { version: string; text: string };
  rebase?: boolean;
}): void {
  const id = variableDraftId(input.projectId, input.environmentId);
  if (input.text === input.pristine) {
    if (variableDraftsCollection.has(id)) variableDraftsCollection.delete(id);
    return;
  }
  if (variableDraftsCollection.has(id)) {
    variableDraftsCollection.update(id, (draft) => {
      draft.text = input.text;
      draft.updatedAt = Date.now();
      if (input.rebase && input.base) {
        draft.baseVersion = input.base.version;
        draft.baseText = input.base.text;
      }
    });
  } else {
    variableDraftsCollection.insert({
      id,
      projectId: input.projectId,
      environmentId: input.environmentId,
      text: input.text,
      updatedAt: Date.now(),
      ...(input.base ? { baseVersion: input.base.version, baseText: input.base.text } : {}),
    });
  }
}

export function clearVariableDraft(projectId: string, environmentId: string): void {
  const id = variableDraftId(projectId, environmentId);
  if (variableDraftsCollection.has(id)) variableDraftsCollection.delete(id);
}
