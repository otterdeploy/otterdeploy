/**
 * `fs` operations against the host data folder (`/data/otterdeploy`). The path
 * derivation is pure and lives in `@otterdeploy/shared/paths`; the side effects
 * (create the root, guarded teardown) live here, api-side only.
 *
 * Everything degrades to a no-op when the root isn't writable (e.g. local dev
 * without `OTTERDEPLOY_DATA_DIR`), so the folder is a convenience layer, never a
 * dependency: losing it never breaks a deploy. See docs/designs/data-folder.md.
 */
import { mkdir, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";

import type { ResourceId } from "@otterdeploy/shared/id";
import { DATA_ROOT, resourceDir } from "@otterdeploy/shared/paths";

let availability: Promise<boolean> | null = null;

/**
 * Whether the data root exists and is writable. Memoized — created `0700` on
 * first call (the tree is secret-bearing). Returns `false` (never throws) when
 * `/data` isn't writable, so callers can guard a write/cleanup without a
 * try/catch and the whole feature gracefully no-ops in dev.
 */
function dataRootAvailable(): Promise<boolean> {
  availability ??= mkdir(DATA_ROOT, { recursive: true, mode: 0o700 })
    .then(() => true)
    .catch(() => false);
  return availability;
}

/**
 * Remove a resource's artifact dir on delete. No-op unless the resolved path
 * sits INSIDE `DATA_ROOT` *and* ends with the `resourceId` — cheap insurance
 * against a path bug nuking the wrong tree (borrowed from Coolify's
 * `endsWith(uuid)` guard). Best-effort: never throws, so it can't fail a delete.
 */
export async function removeResourceDir(id: ResourceId): Promise<void> {
  if (!(await dataRootAvailable())) return;
  const dir = resolve(resourceDir(id));
  const root = resolve(DATA_ROOT);
  if (!dir.startsWith(root + sep) || !dir.endsWith(id)) return;
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}
