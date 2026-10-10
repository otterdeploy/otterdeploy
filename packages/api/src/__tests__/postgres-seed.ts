/**
 * Seeding helpers for the `*.postgres.test.ts` suite (vitest.postgres.config.ts).
 *
 * Every helper writes through the SAME record creators the product uses
 * (`createProject`, `createServiceRecord`, `createDatabaseResourceRecord`,
 * `upsertServiceEnvVar`, ...), so a test inherits the real defaults: the main
 * environment a project is born with, the environment stamp a new resource
 * gets, encrypt-at-rest on env values. Only the rows no creator owns outright
 * (an organization, a git binding) are inserted directly.
 *
 * Every name carries a random suffix: the files share one migrated database.
 */
import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";
import type {
  EnvironmentId,
  GitRepoId,
  OrganizationId,
  ProjectId,
  ResourceId,
} from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { organization } from "@otterdeploy/db/schema/auth";
import { gitInstallation, gitProvider, gitRepo } from "@otterdeploy/db/schema/git";
import { randomUUID } from "node:crypto";

import { createEnvRecord } from "../routers/env/queries";
import { createProject } from "../routers/project/projects";
import { createDatabaseResourceRecord } from "../routers/project/queries/postgres-resource";
import { createServiceRecord } from "../routers/service/queries/service";

/** Short random suffix that is valid in a slug, a hostname and a db name. */
export function uniq(): string {
  return randomUUID().replace(/-/g, "").slice(0, 10);
}

export async function seedOrganization(prefix: string): Promise<OrganizationId> {
  const suffix = uniq();
  const [row] = await db
    .insert(organization)
    .values({ name: `${prefix} ${suffix}`, slug: `${prefix}-${suffix}` })
    .returning({ id: organization.id });
  if (!row) throw new Error("organization insert returned no row");
  return row.id;
}

export interface SeededProject {
  projectId: ProjectId;
  slug: string;
  /** The environment `project.create` makes and points the project at. */
  mainEnvironmentId: EnvironmentId;
}

/** A project through the real create path, which also creates its main
 *  environment. Throws when the create is refused: seeding, not the assertion. */
export async function seedProject(
  organizationId: OrganizationId,
  slug = `p-${uniq()}`,
): Promise<SeededProject> {
  const created = await createProject({ organizationId, name: slug, slug });
  if (created.isErr()) throw new Error(`seed project ${slug}: ${created.error.message}`);
  const mainEnvironmentId = created.value.environmentId;
  if (!mainEnvironmentId) throw new Error(`seed project ${slug} has no main environment`);
  return { projectId: created.value.id, slug, mainEnvironmentId };
}

/** An additional (non-main) environment on a project, e.g. staging. */
export async function seedEnvironment(projectId: ProjectId, slug: string): Promise<EnvironmentId> {
  const row = await createEnvRecord({ projectId, name: slug, slug });
  if (!row) throw new Error(`seed environment ${slug} returned no row`);
  return row.id;
}

/** A postgres database resource whose identity (host, password) is derived
 *  from `tag`, so a test can tell which environment's copy it resolved. */
export async function seedDatabase(input: {
  projectId: ProjectId;
  environmentId: EnvironmentId;
  name: string;
  tag: string;
  /** Defaults to postgres. */
  engine?: DatabaseEngine;
}): Promise<{ resourceId: ResourceId; host: string; password: string }> {
  const host = `${input.name}-${input.tag}-${uniq()}.otterdeploy.internal`;
  const password = `pw-${input.tag}-${uniq()}`;
  const record = await createDatabaseResourceRecord({
    projectId: input.projectId,
    environmentId: input.environmentId,
    name: input.name,
    engine: input.engine ?? "postgres",
    databaseName: "app",
    username: "app",
    password,
    publicHostname: `public-${host}`,
    publicPort: 443,
    publicConnectionString: `postgres://app:${password}@public-${host}:443/app`,
    internalHostname: host,
    internalPort: 5432,
    internalConnectionString: `postgres://app:${password}@${host}:5432/app`,
    upstreamHost: host,
    upstreamPort: 5432,
    caddyLayer4Snippet: "",
  });
  return { resourceId: record.resource.id, host, password };
}

/** An image-sourced service. `hostname` doubles as its internal DNS name. */
export async function seedService(input: {
  projectId: ProjectId;
  environmentId: EnvironmentId;
  name: string;
  hostname?: string;
  stackId?: ResourceId;
  composeService?: string;
}): Promise<{ resourceId: ResourceId; host: string; serviceName: string }> {
  const host = input.hostname ?? `${input.name}-${uniq()}`;
  const serviceName = `od-${host}`.slice(0, 63);
  const record = await createServiceRecord({
    projectId: input.projectId,
    environmentId: input.environmentId,
    name: input.name,
    image: "nginx:alpine",
    internalHostname: host,
    serviceName,
    networkName: `test-net-${uniq()}`,
    stackId: input.stackId ?? null,
    composeService: input.composeService ?? null,
    ports: [],
  });
  // `serviceName` is the runtime container/service name; `host` is the
  // internal DNS alias.
  return { resourceId: record.resource.id, host, serviceName };
}

/** A GitHub App binding owned by `organizationId`: provider -> installation
 *  -> repo, the chain every git-sourced create resolves through. */
export async function seedGitRepo(
  organizationId: OrganizationId,
  fullName: string,
): Promise<GitRepoId> {
  const [provider] = await db
    .insert(gitProvider)
    .values({ organizationId, kind: "github", displayName: "GitHub" })
    .returning({ id: gitProvider.id });
  if (!provider) throw new Error("git provider insert returned no row");
  const [installation] = await db
    .insert(gitInstallation)
    .values({
      providerId: provider.id,
      installationId: `${Math.floor(Math.random() * 1e9)}`,
      accountLogin: fullName.split("/")[0] ?? "owner",
      accountType: "organization",
      repoSelection: "selected",
    })
    .returning({ id: gitInstallation.id });
  if (!installation) throw new Error("git installation insert returned no row");
  const [repo] = await db
    .insert(gitRepo)
    .values({
      installationId: installation.id,
      providerRepoId: `R_${uniq()}`,
      fullName,
      isPrivate: true,
      cloneUrl: `https://github.com/${fullName}.git`,
    })
    .returning({ id: gitRepo.id });
  if (!repo) throw new Error("git repo insert returned no row");
  return repo.id;
}
