/**
 * Apply handler for `project.stack.apply`.
 *
 * Reads the project's saved stackFile, parses it, and pushes env-var
 * changes through the existing database extra-env mutator so the
 * running swarm services pick up the new values. Service resources are
 * not yet apply-driven (the editor will surface them as "skipped" with
 * a reason). After the walk, the saved file is promoted to
 * `lastAppliedFile` and `lastAppliedAt` is stamped.
 */

import { db } from "@otterstack/db";
import { project } from "@otterstack/db/schema/project";
import { eq } from "drizzle-orm";
import { Result, TaggedError } from "better-result";
import type { RequestLogger } from "evlog";

import { type Id, ID_PREFIX as IDP } from "@otterstack/shared/id";
import type { ResourceId } from "../service/errors";

import { stackFileSchema, type StackService } from "../../stack";
import { getEngineAdapter } from "../../swarm";

import { ProjectNotFoundError, type ProjectId } from "./errors";
import { applyPostgresExtraEnv } from "./postgres";
import { getProjectInOrg } from "./queries";

type OrgId = Id<typeof IDP.organization>;

export class StackNotSavedError extends TaggedError("StackNotSavedError")<{
  message: string;
}>() {
  constructor() {
    super({ message: "no saved stackFile to apply — save first, then apply" });
  }
}

export type ApplyStackError = ProjectNotFoundError | StackNotSavedError;

export interface StackApplyResult {
  appliedCount: number;
  skipped: { service: string; reason: string }[];
  lastAppliedAt: string;
}

export async function applyProjectStack(
  input: {
    projectId: ProjectId;
    organizationId: OrgId;
  },
  log: RequestLogger,
): Promise<Result<StackApplyResult, ApplyStackError>> {
  const projectRow = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!projectRow) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }
  if (!projectRow.stackFile) return Result.err(new StackNotSavedError());

  const parsed = stackFileSchema.parse(Bun.YAML.parse(projectRow.stackFile));
  const skipped: { service: string; reason: string }[] = [];
  let appliedCount = 0;

  for (const [name, service] of Object.entries(parsed.services)) {
    const outcome = await applyServiceFromStack(
      {
        projectId: input.projectId,
        organizationId: input.organizationId,
        name,
        service,
      },
      log,
    );
    if (outcome.kind === "applied") appliedCount++;
    else skipped.push({ service: name, reason: outcome.reason });
  }

  const now = new Date();
  await db
    .update(project)
    .set({ lastAppliedFile: projectRow.stackFile, lastAppliedAt: now })
    .where(eq(project.id, input.projectId));

  return Result.ok({
    appliedCount,
    skipped,
    lastAppliedAt: now.toISOString(),
  });
}

type ServiceOutcome = { kind: "applied" } | { kind: "skipped"; reason: string };

async function applyServiceFromStack(
  input: {
    projectId: ProjectId;
    organizationId: OrgId;
    name: string;
    service: StackService;
  },
  log: RequestLogger,
): Promise<ServiceOutcome> {
  const ext = input.service["x-otterstack"];
  if (ext.kind !== "database") {
    return {
      kind: "skipped",
      reason: "service resources are edited via the UI for now",
    };
  }
  if (!ext.engine) {
    return { kind: "skipped", reason: "database service missing engine" };
  }

  const adapter = getEngineAdapter(ext.engine);
  const env = input.service.env ?? {};
  const nextExtraEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (adapter.reservedEnvKeys.has(k)) continue;
    nextExtraEnv[k] = v;
  }

  const result = await applyPostgresExtraEnv(
    {
      projectId: input.projectId,
      organizationId: input.organizationId,
      resourceId: ext.resourceId as ResourceId,
      nextExtraEnv,
    },
    log,
  );
  if (result.isErr()) return { kind: "skipped", reason: result.error.message };
  return { kind: "applied" };
}
