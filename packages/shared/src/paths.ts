/**
 * Host data folder: the single source of truth for where platform state lives
 * on disk. Pure path derivation only (no `fs`, no side effects) so it's safe to
 * import from any layer (builder, api). The `fs` operations (create / guarded
 * remove / availability check) live in `packages/api/src/lib/data-dir.ts`.
 *
 * The tree separates by OWNER AND LIFECYCLE at the top level, then tenant data
 * mirrors the DB hierarchy (org → project → environment → resource), keyed by
 * stable ids (never names) so it is rename-safe and collision-free. The first
 * path segment answers "can I delete this?":
 *
 *   platform/  the platform itself — load-bearing, 0700
 *   orgs/      all tenant data — nothing tenant-owned lives outside it
 *   work/      ephemeral build scratch — a crash here loses nothing durable
 *   cache/     regenerable — always safe to wipe entirely
 *
 * See docs/designs/data-folder.md.
 */
import type {
  DeploymentId,
  EnvironmentId,
  OrganizationId,
  ProjectId,
  ResourceId,
} from "./id";

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

/* ------------------------------------------------------------------------- *
 * platform/ — the platform itself. Load-bearing; never swept.
 *
 * Two platform paths have no TS helper on purpose, because nothing in this
 * codebase writes them: `platform/source/` (the install root, owned by
 * scripts/install.sh — the default `OTTERDEPLOY_INSTALL_DIR`) and
 * `platform/backups/<ts>-<reason>/` (self-update safety sets: control-plane
 * dump + env + override, written by the deploy procedure). Add a helper here
 * the day code needs one; the layout contract lives in
 * docs/designs/data-folder.md.
 * ------------------------------------------------------------------------- */

/** Reconciled Caddyfile + snippets, bind-mounted into the caddy container. */
export const caddyDir = (): string => `${DATA_ROOT}/platform/caddy`;

/** Managed GeoIP database: the default location the edge-log sink downloads a
 *  free IP→country MMDB to when `EDGE_LOG_GEOIP_DB` isn't set. See
 *  packages/api/src/edge-logs/geo.ts. */
export const geoDbPath = (): string => `${DATA_ROOT}/platform/geoip/dbip-country.mmdb`;

/** Managed IP→ASN database, sibling of the country DB: enriches firewall
 *  decisions (and anything else) with AS number/org. Same managed-download
 *  semantics as `geoDbPath`. */
export const asnDbPath = (): string => `${DATA_ROOT}/platform/geoip/asn.mmdb`;

/** Loopback image backing the logical-tier DB branch pool on non-ZFS hosts. */
export const branchPoolImagePath = (): string => `${DATA_ROOT}/platform/branch-pool.img`;

/** Best-effort snapshot of the in-flight self-update run, so the final outcome
 *  of a real cutover survives the server container being recreated. */
export const updateStatusPath = (): string => `${DATA_ROOT}/platform/update-status.json`;

/* ------------------------------------------------------------------------- *
 * orgs/ — all tenant data. Mirrors org → project → env → resource; each level
 * reconciles against its DB table (the orphan sweep), and deleting an org is
 * one subtree.
 * ------------------------------------------------------------------------- */

/**
 * Identifies one resource's place in the tenant tree. `environmentId: null`
 * means the project's main environment (the DB convention: a NULL
 * `environment_id` row belongs to main) and lands under `envs/main/`.
 */
export interface ResourceRef {
  organizationId: OrganizationId;
  projectId: ProjectId;
  environmentId: EnvironmentId | null;
  resourceId: ResourceId;
}

/** Path segment for an environment: the stable env id, or `main` for the NULL
 *  (main) environment. */
export const envSegment = (environmentId: EnvironmentId | null): string =>
  environmentId ?? "main";

/** Root of one organization's subtree. */
export const orgDir = (organizationId: OrganizationId): string =>
  `${DATA_ROOT}/orgs/${organizationId}`;

/**
 * Root of the platform-managed local backup destination for one org: the
 * durable rustic repos themselves (one repo per scope), NOT the per-run staging
 * dumps (those are scratch under the resource's `backup-staging/`). Restorable
 * history never lives under a path whose contents look disposable.
 */
export const orgBackupRepoRoot = (organizationId: OrganizationId): string =>
  `${DATA_ROOT}/orgs/${organizationId}/backups`;

/** Root of one project's subtree. */
export const projectDir = (organizationId: OrganizationId, projectId: ProjectId): string =>
  `${DATA_ROOT}/orgs/${organizationId}/projects/${projectId}`;

/** Per-project DR escape hatch: exported manifest snapshot + rendered compose.
 *  DR/audit only, never `up`'d by the platform. */
export const escapeHatchDir = (organizationId: OrganizationId, projectId: ProjectId): string =>
  `${projectDir(organizationId, projectId)}/escape-hatch`;

/** Root of one environment's subtree within a project. */
export const envDir = (
  organizationId: OrganizationId,
  projectId: ProjectId,
  environmentId: EnvironmentId | null,
): string => `${projectDir(organizationId, projectId)}/envs/${envSegment(environmentId)}`;

/**
 * One resource, one home: everything a resource owns lives under this single
 * directory — `meta.json`, `ssl/`, `init/`, `volumes/`, `backup-staging/`.
 * "Everything for resource X" is one `ls`; deleting the resource is one guarded
 * subtree removal.
 */
export const resourceDir = (ref: ResourceRef): string =>
  `${envDir(ref.organizationId, ref.projectId, ref.environmentId)}/resources/${ref.resourceId}`;

/** Managed DB data volume for a resource: the canonical, rename-safe placement
 *  keyed by the stable `resourceId` (NOT the Docker volume name). A branch is a
 *  new resource → its own dir automatically. On a ZFS host this is a managed
 *  dataset so branches are thin clones. See docs/designs/pr-previews.md §4.3. */
export const volumeDir = (ref: ResourceRef): string => `${resourceDir(ref)}/volumes`;

/** Compose-stack member volume: one subdir per named member under the
 *  resource's volume dir (a compose resource fans out to N member volumes). */
export const composeVolumeDir = (ref: ResourceRef, member: string): string =>
  `${volumeDir(ref)}/${member}`;

/** Backup dumps staged before off-cluster upload. Scratch: written and cleared
 *  per run, TTL-swept. Durable repos live under `orgBackupRepoRoot`. */
export const backupStagingDir = (ref: ResourceRef): string =>
  `${resourceDir(ref)}/backup-staging`;

/* ------------------------------------------------------------------------- *
 * work/ — ephemeral build scratch, TTL-swept by the builder. Kept
 * project-keyed (not org-keyed) on purpose: this is the high-churn hot loop
 * and the shallow path keeps it simple.
 * ------------------------------------------------------------------------- */

/** Per-build clone + context. Ephemeral; cleaned after each build. */
export const buildDir = (projectId: ProjectId, deploymentId: DeploymentId): string =>
  `${DATA_ROOT}/work/builds/${projectId}/${deploymentId}`;

/** Uploaded source tarball for a `source: "upload"` build, staged by the server
 *  (from the CLI's `otterdeploy deploy`) for the builder to extract into its
 *  work dir. A SIBLING of `buildDir` (not inside it) because the builder's
 *  `resolveWorkDir` requires an empty dir to extract into. Consumed (deleted)
 *  by the builder after extraction; orphans are reclaimed by the data-folder
 *  sweep. */
export const sourceTarballPath = (projectId: ProjectId, deploymentId: DeploymentId): string =>
  `${DATA_ROOT}/work/sources/${projectId}/${deploymentId}.tar.gz`;

/* ------------------------------------------------------------------------- *
 * cache/ — regenerable. Wiping this directory is always safe.
 * ------------------------------------------------------------------------- */

/** BuildKit layer cache (per-image OCI caches + buildx state). */
export const buildxCacheDir = (): string => `${DATA_ROOT}/cache/buildx`;
