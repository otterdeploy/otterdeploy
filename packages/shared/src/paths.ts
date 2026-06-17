/**
 * Host data folder — the single source of truth for where platform-generated
 * artifacts live on disk (build clones, backup dumps, DR escape-hatch exports,
 * db init material). Pure path derivation only — no `fs`, no side effects — so
 * it's safe to import from any layer (builder, api). The `fs` operations
 * (create / guarded remove / availability check) live in
 * `packages/api/src/lib/data-dir.ts`.
 *
 * Keyed by the stable `resourceId` (not the `${kind}:${name}` node id), so the
 * tree survives renames and can't collide. See docs/designs/data-folder.md.
 */
import type { DeploymentId, ProjectId, ResourceId } from "./id";

/**
 * Root for everything below. Defaults to `/data/otterdeploy`; override with
 * `OTTERDEPLOY_DATA_DIR` when `/data` isn't writable (e.g. local dev, or an
 * unprivileged host). No trailing slash.
 */
export const DATA_ROOT = (
  process.env.OTTERDEPLOY_DATA_DIR ?? "/data/otterdeploy"
).replace(/\/+$/, "");

/** Per-resource artifact dir — db ssl/init material, etc. */
export const resourceDir = (id: ResourceId): string =>
  `${DATA_ROOT}/resources/${id}`;

/** Per-build clone + context. Ephemeral; cleaned after each build. */
export const buildDir = (deploymentId: DeploymentId): string =>
  `${DATA_ROOT}/builds/${deploymentId}`;

/** Backup dumps staged before off-cluster upload. */
export const backupDir = (id: ResourceId): string =>
  `${DATA_ROOT}/backups/${id}`;

/** Per-project DR escape hatch — exported manifest + rendered compose. */
export const projectDir = (id: ProjectId): string =>
  `${DATA_ROOT}/projects/${id}`;
