/**
 * Phase 1 stack-file diff handler.
 *
 * Read-only canary: renders the project's row state into a StackFile,
 * applies engine adapter defaults, emits compose YAML, then compares
 * that string against the project row's saved `stackFile` column. Used
 * by the team to verify the renderer matches what's actually running
 * before subsequent phases turn this surface read-write.
 */

import { db } from "@otterstack/db";
import { project } from "@otterstack/db/schema/project";
import { and, eq } from "drizzle-orm";
import { Result } from "better-result";

import { type Id, ID_PREFIX as IDP } from "@otterstack/shared/id";

import {
  applyEngineDefaults,
  renderProjectFromRows,
  toComposeYaml,
  unifiedDiff,
} from "../../stack";

import { ProjectNotFoundError, type ProjectId } from "./errors";
import { getProjectInOrg } from "./queries";

type OrgId = Id<typeof IDP.organization>;

export interface StackDiffResult {
  renderedYaml: string;
  savedYaml: string | null;
  diff: string;
}

async function loadSavedFile(projectId: ProjectId): Promise<string | null> {
  const [row] = await db
    .select({ stackFile: project.stackFile })
    .from(project)
    .where(and(eq(project.id, projectId)))
    .limit(1);
  return row?.stackFile ?? null;
}

export async function diffProjectStack(input: {
  projectId: ProjectId;
  organizationId: OrgId;
}): Promise<Result<StackDiffResult, ProjectNotFoundError>> {
  const projectRow = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!projectRow) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const rendered = applyEngineDefaults(
    await renderProjectFromRows(input.projectId),
  );
  const renderedYaml = toComposeYaml(rendered);
  const savedYaml = await loadSavedFile(input.projectId);
  const diff = unifiedDiff(savedYaml ?? "", renderedYaml);

  return Result.ok({ renderedYaml, savedYaml, diff });
}
