/**
 * Host data folder — the single source of truth for where platform-generated
 * artifacts live on disk (build clones, backup dumps, DR escape-hatch exports,
 * db init material). Pure path derivation only — no `fs`, no side effects — so
 * it's safe to import from any layer (builder, api). The `fs` operations
 * (create / guarded remove / availability check) live in
 * `packages/api/src/lib/data-dir.ts`.
 *
 * Grouped by `projectId`, then keyed by the stable child id (`resourceId` /
 * `deploymentId`, not the `${kind}:${name}` node id). The project level makes
 * the tree navigable per project on disk; the stable child id keeps it
 * rename-safe and collision-free. See docs/designs/data-folder.md.
 */
import type { DeploymentId, ProjectId, ResourceId } from "./id";

/**
 * Root for everything below. Defaults to `/data/otterdeploy`; override with
 * `OTTERDEPLOY_DATA_DIR` when `/data` isn't writable (e.g. local dev, or an
 * unprivileged host). No trailing slash.
 */
export const DATA_ROOT = (process.env.OTTERDEPLOY_DATA_DIR ?? "/data/otterdeploy").replace(
  /\/+$/,
  "",
);

/** Per-resource artifact dir — db ssl/init material, etc. Nested under its
 *  project: `resources/<projectId>/<resourceId>`. */
export const resourceDir = (projectId: ProjectId, id: ResourceId): string =>
  `${DATA_ROOT}/resources/${projectId}/${id}`;

/** Per-build clone + context. Ephemeral; cleaned after each build. Nested under
 *  its project: `builds/<projectId>/<deploymentId>`. */
export const buildDir = (projectId: ProjectId, deploymentId: DeploymentId): string =>
  `${DATA_ROOT}/builds/${projectId}/${deploymentId}`;

/** Backup dumps staged before off-cluster upload. Nested under its project:
 *  `backups/<projectId>/<resourceId>`. */
export const backupDir = (projectId: ProjectId, id: ResourceId): string =>
  `${DATA_ROOT}/backups/${projectId}/${id}`;

/** Per-project DR escape hatch — exported manifest + rendered compose. */
export const projectDir = (id: ProjectId): string => `${DATA_ROOT}/projects/${id}`;
