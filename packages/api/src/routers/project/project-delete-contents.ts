import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { databaseResource, resource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import type { ProjectScope } from "./manifest";

import { ProjectResourceDeleteError } from "./errors";
import { deleteProjectResource } from "./resource-delete";

/** All environments and previews belong to a confirmed whole-project delete.
 * Stacks remove their children themselves; re-read after each teardown rather
 * than calling delete twice on those children. Preview branches and hosted
 * databases must go before their source/server dependency. */
async function remainingResources(projectId: ProjectScope["projectId"]) {
  const rows = await db
    .select({
      id: resource.id,
      name: resource.name,
      type: resource.type,
      previewId: resource.previewId,
      hostResourceId: databaseResource.hostResourceId,
    })
    .from(resource)
    .leftJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
    .where(eq(resource.projectId, projectId))
    .$withCache(false);
  const rank = (row: (typeof rows)[number]) =>
    row.type === "compose" ? 0 : row.previewId ? 1 : row.hostResourceId ? 2 : 3;
  return rows.sort((a, b) => rank(a) - rank(b));
}

export async function deleteProjectContents(
  scope: ProjectScope,
  log: RequestLogger,
): Promise<Result<void, ProjectResourceDeleteError>> {
  let remaining = await remainingResources(scope.projectId);
  // Bound work to the original inventory. Concurrent creates must be reviewed
  // on a retry, not silently added to an already confirmed deletion.
  const originalIds = new Set(remaining.map((row) => row.id));
  while (remaining.length > 0) {
    const next = remaining[0];
    if (!next) break;
    if (!originalIds.delete(next.id)) {
      return Result.err(
        new ProjectResourceDeleteError({
          resourceName: next.name,
          message: `Project was not deleted: ${next.name} still exists or was added during deletion. Reload and retry.`,
        }),
      );
    }
    const result = await Result.tryPromise({
      try: () => deleteProjectResource({ ...scope, resourceId: next.id }, log),
      catch: (cause) => cause,
    });
    const teardown = result.isOk() ? result.value : result;
    if (teardown.isErr()) {
      const cause = teardown.error;
      const detail = cause instanceof Error ? cause.message : "resource teardown failed";
      return Result.err(
        new ProjectResourceDeleteError({
          resourceName: next.name,
          message: `Project was not deleted: could not remove ${next.name}. ${detail}`,
        }),
      );
    }
    remaining = await remainingResources(scope.projectId);
  }
  return Result.ok(undefined);
}
