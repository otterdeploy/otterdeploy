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
import type { PreviewId, ProjectId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { and, eq } from "drizzle-orm";
import { log } from "evlog";
import { randomBytes } from "node:crypto";

import type { BranchDatabaseSpec } from "../runtime/types";

import { insertDeployment } from "../routers/project/deployments";
import { deriveInternalDbCredentials } from "../routers/project/postgres/credentials";
import {
  createDatabaseResourceRecord,
  listDatabaseResourceRecords,
} from "../routers/project/queries";
import { buildContainerName, buildVolumeName } from "../routers/project/view-helpers";
import { runtime } from "../runtime";
import { resolveSnapshotDriver } from "../runtime/snapshot";
import { getEngineAdapter } from "../swarm";

export async function branchProjectDatabases(input: {
  projectId: ProjectId;
  projectSlug: string;
  previewId: PreviewId;
  /** The preview's repo-qualified slug (`<repoSlug>-pr-<7>`), used to derive
   *  the branch's distinct identity — and reused verbatim at teardown. */
  previewSlug: string;
  rlog?: RequestLogger;
}): Promise<number> {
  const driver = await resolveSnapshotDriver();
  const records = await listDatabaseResourceRecords(input.projectId);
  const bases = records.filter(
    // Opt-in only: previewBranching=false databases are shared with the base.
    (r) => r.resource.previewId == null && r.database.previewBranching,
  );
  let branched = 0;

  for (const base of bases) {
    if (base.database.engine !== "postgres") continue; // v1: Postgres only
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

  await runtime().branchDatabase(spec, input.rlog);
}
