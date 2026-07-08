/**
 * Branch a project's OPT-IN databases into a preview. Branching is opt-in per
 * database (`databaseResource.previewBranching`, default off): an unbranched
 * database is shared with the base via the resolver's fallback, so a PR costs
 * no extra data copy unless the operator asked for isolation. For each opted-in
 * BASE database (Postgres only in v1), mint a fresh preview-scoped database
 * resource that reuses the BASE's name — so the preview's
 * `${{<db>.DATABASE_URL}}` resolves to the branch instead of production — then
 * copy the data in via the branching engine (`runtime().branchDatabase`).
 *
 * Idempotent per (preview, base): a second `synchronize` skips DBs already
 * branched. Best-effort per DB: one failure logs and the rest proceed.
 *
 * NOTE: runs inline from the webhook today. For large DBs the copy dump/restore
 * can be slow enough to risk GitHub's ~10s webhook timeout — move to a background
 * "preview.provision" job before heavy production use.
 */
import type { GitRepoId, PreviewId, ProjectId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { resource, serviceEnvVar, serviceResource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { and, eq, isNull } from "drizzle-orm";
import { log } from "evlog";
import { randomBytes } from "node:crypto";

import type { BranchDatabaseSpec } from "../runtime/types";

import { extractRefs } from "../lib/variables/parser";
import { insertDeployment } from "../routers/project/deployments";
import { deriveInternalDbCredentials } from "../routers/project/postgres/credentials";
import {
  createDatabaseResourceRecord,
  deleteResourceById,
  listDatabaseResourceRecords,
} from "../routers/project/queries";
import { buildContainerName, buildVolumeName } from "../routers/project/view-helpers";
import { runtime } from "../runtime";
import { resolveSnapshotDriver } from "../runtime/snapshot";
import { getEngineAdapter } from "../swarm";

/**
 * The BASE Postgres databases this preview's services actually CONNECT TO —
 * i.e. a platform-run database resource REACHABLE from at least one of the
 * preview's opted-in git services through `${{<res>.…}}` refs, directly OR
 * transitively via another service (A → `${{B.…}}` and B → `${{pg.…}}` means A
 * uses pg). Only these are meaningful to branch: a service that talks to an
 * external DB (raw DATABASE_URL, no ref) or a DB nothing in the preview reaches
 * gets nothing from a branch — and conversely a reachable DB MUST be branched or
 * the preview silently runs on production. Mirrors the recursive resolver, so
 * the branch set matches what the services will actually resolve to. Reused by
 * the branch path (what to copy) and the list query (whether to offer control).
 */
export async function referencedBaseDatabases(input: {
  projectId: ProjectId;
  gitRepoId: GitRepoId;
}): Promise<BaseRecord[]> {
  // The opted-in git services this preview builds — the BFS seed (the only
  // services that actually run in the preview).
  const seeds = await db
    .select({ id: resource.id })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(
      and(
        eq(resource.projectId, input.projectId),
        eq(resource.type, "service"),
        eq(serviceResource.source, "git"),
        eq(serviceResource.gitRepoId, input.gitRepoId),
        eq(serviceResource.previewsEnabled, true),
        isNull(resource.previewId),
      ),
    );
  if (seeds.length === 0) return [];

  const records = await listDatabaseResourceRecords(input.projectId);
  const bases = records.filter(
    (r) => r.resource.previewId == null && r.database.engine === "postgres",
  );
  if (bases.length === 0) return [];
  const baseByName = new Map(bases.map((b) => [b.resource.name, b] as const));

  // Base resources by name (to resolve a ref to its target) and each base
  // service's outgoing refs. extractRefs parses `${{…}}` exactly, so unlike a
  // LIKE scan it never false-matches on names containing `_`/`%`.
  const allRes = await db
    .select({ id: resource.id, name: resource.name, type: resource.type })
    .from(resource)
    .where(and(eq(resource.projectId, input.projectId), isNull(resource.previewId)));
  const resByName = new Map(allRes.map((r) => [r.name, r] as const));

  const envRows = await db
    .select({ serviceResourceId: serviceEnvVar.serviceResourceId, value: serviceEnvVar.value })
    .from(serviceEnvVar)
    .innerJoin(resource, eq(resource.id, serviceEnvVar.serviceResourceId))
    .where(and(eq(resource.projectId, input.projectId), isNull(serviceEnvVar.previewId)));
  const refsById = new Map<string, Set<string>>();
  for (const row of envRows) {
    let set = refsById.get(row.serviceResourceId);
    if (!set) {
      set = new Set<string>();
      refsById.set(row.serviceResourceId, set);
    }
    for (const ref of extractRefs(row.value)) set.add(ref.resource);
  }

  // Forward BFS over the ref graph from the seed services; collect every base
  // DB name reached, following service→service edges transitively.
  const used = new Set<string>();
  const visited = new Set<string>();
  const queue: string[] = seeds.map((s) => s.id);
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    for (const name of refsById.get(id) ?? []) {
      if (baseByName.has(name)) used.add(name);
      const target = resByName.get(name);
      if (target && target.type === "service" && !visited.has(target.id)) {
        queue.push(target.id);
      }
    }
  }
  return bases.filter((b) => used.has(b.resource.name));
}

export async function branchProjectDatabases(input: {
  projectId: ProjectId;
  projectSlug: string;
  previewId: PreviewId;
  /** The preview's repo whose opted-in services define which DBs are used. */
  gitRepoId: GitRepoId;
  /** The preview's repo-qualified slug (`<repoSlug>-pr-<7>`), used to derive
   *  the branch's distinct identity — and reused verbatim at teardown. */
  previewSlug: string;
  /** Branch every REFERENCED base postgres DB regardless of the per-database
   *  opt-in flag — the explicit "enable DB branch for this preview" control.
   *  Default false (the PR-open path respects the opt-in). Either way we only
   *  touch DBs the preview's services actually connect to. */
  force?: boolean;
  rlog?: RequestLogger;
}): Promise<number> {
  const driver = await resolveSnapshotDriver();
  // Only DBs the preview's services connect to — never mint an orphan branch
  // for a database nothing in this preview references.
  const referenced = await referencedBaseDatabases({
    projectId: input.projectId,
    gitRepoId: input.gitRepoId,
  });
  const bases = referenced.filter(
    // Opt-in (or forced by the per-preview control): shared-with-base otherwise.
    (r) => input.force || r.database.previewBranching,
  );
  let branched = 0;

  for (const base of bases) {
    if (await branchExists(input.projectId, input.previewId, base.resource.name)) continue;

    const done = await Result.tryPromise({
      try: () => branchOne(input, base, driver.kind),
      catch: (cause) => cause,
    });
    if (done.isOk()) branched++;
    else
      log.warn({
        preview: { step: "branch-db", db: base.resource.name, previewId: input.previewId },
        err: done.error,
      });
  }
  return branched;
}

async function branchExists(
  projectId: ProjectId,
  previewId: PreviewId,
  name: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: resource.id })
    .from(resource)
    .where(
      and(
        eq(resource.projectId, projectId),
        eq(resource.name, name),
        eq(resource.previewId, previewId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

type BaseRecord = Awaited<ReturnType<typeof listDatabaseResourceRecords>>[number];

async function branchOne(
  input: {
    projectId: ProjectId;
    projectSlug: string;
    previewId: PreviewId;
    previewSlug: string;
    rlog?: RequestLogger;
  },
  base: BaseRecord,
  strategy: "zfs" | "copy",
): Promise<void> {
  const engine = "postgres" as const;
  const { projectSlug } = input;
  // A distinct resource name (`<db>-pr-7`) drives distinct db/user/host/volume;
  // the branch RESOURCE keeps the base name so refs resolve to it in this env.
  const branchResourceName = `${base.resource.name}-${input.previewSlug}`;
  const password = randomBytes(18).toString("base64url");
  const creds = deriveInternalDbCredentials({
    engine,
    projectSlug,
    resourceName: branchResourceName,
    password,
  });

  const created = await createDatabaseResourceRecord({
    projectId: input.projectId,
    name: base.resource.name,
    engine,
    status: "valid",
    previewId: input.previewId,
    branchedFromResourceId: base.resource.id,
    databaseName: creds.databaseName,
    username: creds.username,
    password,
    publicEnabled: false,
    // Previews don't expose DBs publicly; these NOT-NULL + unique columns get
    // the branch's own (unique) internal identity as an unused placeholder.
    publicHostname: creds.internalHostname,
    publicPort: 443,
    publicConnectionString: creds.internalConnectionString,
    internalHostname: creds.internalHostname,
    internalPort: creds.internalPort,
    internalConnectionString: creds.internalConnectionString,
    upstreamHost: creds.internalHostname,
    upstreamPort: creds.internalPort,
    caddyLayer4Snippet: "",
  });

  const dep = await insertDeployment({
    resourceId: created.resource.id,
    image: getEngineAdapter(engine).defaultImage,
    reason: "create",
    previewId: input.previewId,
    snapshot: {},
  });

  const spec: BranchDatabaseSpec = {
    engine,
    resourceId: created.resource.id,
    serviceName: buildContainerName({ engine, projectSlug, resourceName: branchResourceName }),
    volumeName: buildVolumeName({ engine, projectSlug, resourceName: branchResourceName }),
    hostnameAlias: creds.internalHostname,
    databaseName: creds.databaseName,
    username: creds.username,
    password,
    projectSlug,
    deploymentId: dep.id,
    public: false,
    strategy,
    sourceServiceName: buildContainerName({
      engine,
      projectSlug,
      resourceName: base.resource.name,
    }),
    sourceResourceId: base.resource.id,
    sourceCredentials: {
      databaseName: base.database.databaseName,
      username: base.database.username,
      password: base.database.password,
    },
  };

  // A failed copy must not leave a "valid" branch resource behind — the
  // resolver would then point preview services at a dead DB and branchExists
  // would permanently skip a retry. Compensate: delete the branch row (cascades
  // its deployment) and rethrow so the caller logs it.
  const copied = await Result.tryPromise({
    try: () => runtime().branchDatabase(spec, input.rlog),
    catch: (cause) => cause,
  });
  if (copied.isErr()) {
    await Result.tryPromise({
      try: () => deleteResourceById(created.resource.id),
      catch: (cause) => cause,
    });
    throw copied.error;
  }
}
