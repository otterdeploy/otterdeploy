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
// oxlint-disable-next-line node/no-process-env -- env boundary: this is a pure, side-effect-free path module imported by every layer (builder, api); reading the raw var keeps full `@otterdeploy/env` validation out of its import graph (see file header + packages/api/src/runtime/index.ts for the same pattern).
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

/** Managed GeoIP database — the default location the edge-log sink downloads a
 *  free IP→country MMDB to when `EDGE_LOG_GEOIP_DB` isn't set. See
 *  packages/api/src/edge-logs/geo.ts. */
export const geoDbPath = (): string => `${DATA_ROOT}/geoip/dbip-country.mmdb`;

/** Managed IP→ASN database, sibling of the country DB — enriches firewall
 *  decisions (and anything else) with AS number/org. Same managed-download
 *  semantics as `geoDbPath`. */
export const asnDbPath = (): string => `${DATA_ROOT}/geoip/asn.mmdb`;

/** Managed DB data volume — the canonical, rename-safe placement keyed by the
 *  stable `resourceId` (NOT the Docker volume name). A branch is a new resource
 *  → its own dir automatically. On a ZFS host this tree is a managed dataset so
 *  branches are thin clones. See docs/designs/pr-previews.md §4.3. */
export const volumeDir = (projectId: ProjectId, resourceId: ResourceId): string =>
  `${DATA_ROOT}/volumes/${projectId}/${resourceId}`;

/** Compose-stack member volume — one subdir per named member under the
 *  resource's volume dir (a compose resource fans out to N member volumes). */
export const composeVolumeDir = (
  projectId: ProjectId,
  resourceId: ResourceId,
  member: string,
): string => `${DATA_ROOT}/volumes/${projectId}/${resourceId}/${member}`;
