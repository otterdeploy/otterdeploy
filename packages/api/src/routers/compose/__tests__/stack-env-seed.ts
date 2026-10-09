/**
 * Shared setup for the stack-scope Postgres suites (./stack-env-scope and
 * ./template-install-scope): a tenant project, a stack written the way every
 * install wrote one before stacks had a scope, and the reads that judge them.
 */
import type { EnvironmentId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { projectEnvVar } from "@otterdeploy/db/schema/project";
import { and, eq } from "drizzle-orm";
import { createRequestLogger } from "evlog";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Context } from "../../../context";

import { createMemberContext } from "../../../__tests__/postgres-actors";
import { seedOrganization, seedProject, uniq } from "../../../__tests__/postgres-seed";
import { listProjectEnvVars } from "../../project/queries/project-env";
import { createComposeRecord } from "../queries";
import { loadStackInterpolationVars } from "../stack-env";

export const log = () => createRequestLogger({ method: "TEST", path: "/compose" });

export interface Seeded {
  organizationId: Awaited<ReturnType<typeof seedOrganization>>;
  projectId: ProjectId;
  mainEnvironmentId: EnvironmentId;
  /** A real member of the organization, as a session caller. */
  member: Context;
}

export async function seedTenantProject(label: string): Promise<Seeded> {
  const organizationId = await seedOrganization(label);
  const { projectId, mainEnvironmentId } = await seedProject(organizationId);
  const member = await createMemberContext(organizationId);
  return { organizationId, projectId, mainEnvironmentId, member };
}

/** A stack written the way every install wrote one before stacks had their
 *  own variables: the row,
 *  no variables of its own, its `${VAR}` values in the project bag. */
export async function seedLegacyStack(
  t: Seeded,
  content: string,
  extra: { files?: Array<{ path: string; content: string; interpolate?: boolean }> } = {},
): Promise<ResourceId> {
  const stack = await createComposeRecord({
    projectId: t.projectId,
    environmentId: t.mainEnvironmentId,
    name: `legacy-${uniq()}`,
    source: "inline",
    composeContent: content,
    files: extra.files,
    stackName: `legacy-${uniq()}`,
    services: [],
  });
  return stack.resource.id;
}

export async function projectBag(t: Seeded): Promise<Record<string, string>> {
  const rows = await listProjectEnvVars({
    projectId: t.projectId,
    environmentId: t.mainEnvironmentId,
  });
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function stackVars(t: Seeded, stackResourceId: ResourceId) {
  return loadStackInterpolationVars({
    projectId: t.projectId,
    environmentId: t.mainEnvironmentId,
    stackResourceId,
  });
}

export const POSTGRES_STACK = `services:
  db:
    image: postgres:17
    environment:
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
  app:
    image: example/app:1
    environment:
      DATABASE_URL: postgres://app:\${POSTGRES_PASSWORD}@db/app
      JWT_SECRET: \${JWT_SECRET}
`;

/** The data half of the stack_env_var migration, run again against rows the
 *  test seeds (the suite's setup applied it once, to an empty table). */
export function migrationDataStatement(): string {
  const file = fileURLToPath(
    new URL(
      "../../../../../db/src/migrations/20261007140000_stack_env_var/migration.sql",
      import.meta.url,
    ),
  );
  const statements = readFileSync(file, "utf8").split("--> statement-breakpoint");
  const data = statements.at(-1);
  if (!data?.includes('INSERT INTO "stack_env_var"')) throw new Error("migration data step moved");
  return data;
}

export async function storedProjectRows(t: Seeded) {
  return db
    .select({ key: projectEnvVar.key, value: projectEnvVar.value })
    .from(projectEnvVar)
    .where(
      and(
        eq(projectEnvVar.projectId, t.projectId),
        eq(projectEnvVar.environmentId, t.mainEnvironmentId),
      ),
    )
    .orderBy(projectEnvVar.key);
}
