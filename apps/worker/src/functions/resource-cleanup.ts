import { createLogger } from "@otterdeploy/logger";
import { removeService, removeVolume, stackRemove } from "@otterdeploy/docker";
import { db, eq } from "@otterdeploy/db";
import { environment } from "@otterdeploy/db/schema/project";
import {
  getDatabaseServiceName,
  getProjectScopedDatabaseServiceName,
  getProjectScopedStackName,
  getResourceScopedDatabaseServiceName,
  getResourceScopedStackName,
  getStackName,
} from "@otterdeploy/domain/database-provisioner";
import { Result } from "better-result";

import { inngest } from "../inngest";

const logger = createLogger("resource-cleanup");
const CLEANUP_STEP_TIMEOUT_MS = 30_000;
const CLEANUP_STEP_MAX_RETRIES = 3;

function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("not found") ||
    message.includes("no such") ||
    message.includes("does not exist") ||
    message.includes("nothing found")
  );
}

async function runNonFatalCleanupStep(
  label: string,
  action: () => Promise<Result<void, Error>>,
) {
  for (let attempt = 1; attempt <= CLEANUP_STEP_MAX_RETRIES; attempt++) {
    const result = await Promise.race([
      action(),
      new Promise<Result<void, Error>>((resolve) =>
        setTimeout(
          () =>
            resolve(
              Result.err(
                new Error(
                  `Cleanup step timed out after ${CLEANUP_STEP_TIMEOUT_MS}ms`,
                ),
              ),
            ),
          CLEANUP_STEP_TIMEOUT_MS,
        ),
      ),
    ]);

    if (result.isOk()) {
      if (attempt > 1) {
        logger.info({ label, attempt }, "Cleanup action succeeded after retry");
      }
      return;
    }

    if (isNotFoundError(result.error)) {
      logger.info({ label, err: result.error.message }, "Cleanup target already absent");
      return;
    }

    if (attempt >= CLEANUP_STEP_MAX_RETRIES) {
      logger.warn(
        { label, err: result.error, attempts: CLEANUP_STEP_MAX_RETRIES },
        "Cleanup action failed permanently",
      );
      return;
    }

    logger.warn(
      { label, err: result.error, attempt },
      "Cleanup action failed, retrying",
    );
  }
}

export const resourceCleanup = inngest.createFunction(
  {
    id: "resource-cleanup",
    retries: 1,
  },
  { event: "resource.deleted" },
  async ({ event, step }) => {
    const { resourceId, projectId, environmentId } = event.data;

    const naming = await step.run("resolve-environment-slugs", async () => {
      const envRow = await db.query.environment.findFirst({
        where: eq(environment.id, environmentId),
        columns: { id: true, slug: true },
        with: {
          project: {
            columns: { id: true, slug: true },
          },
        },
      });
      return {
        projectSlug: envRow?.project?.slug ?? projectId,
        environmentSlug: envRow?.slug ?? environmentId,
      };
    });

    const appServiceName = `otterstack-${resourceId}`;
    const environmentStackName = getStackName(naming.projectSlug, naming.environmentSlug);
    const environmentDatabaseServiceName = `${environmentStackName}_${getDatabaseServiceName(resourceId)}`;
    const projectStackName = getProjectScopedStackName(projectId);
    const projectDatabaseServiceName = `${projectStackName}_${getProjectScopedDatabaseServiceName(resourceId)}`;
    const resourceStackName = getResourceScopedStackName(resourceId);
    const resourceDatabaseServiceName = `${resourceStackName}_${getResourceScopedDatabaseServiceName(resourceId)}`;
    const databaseVolumeName = `otterstack-${resourceId}-data`;

    await step.run("cleanup-services", async () => {
      await runNonFatalCleanupStep("remove-app-service", () => removeService(appServiceName));
      await runNonFatalCleanupStep("remove-environment-db-service", () => removeService(environmentDatabaseServiceName));
      await runNonFatalCleanupStep("remove-resource-db-service", () => removeService(resourceDatabaseServiceName));
      await runNonFatalCleanupStep("remove-project-db-service", () => removeService(projectDatabaseServiceName));
    });

    await step.run("cleanup-resource-stack", async () => {
      await runNonFatalCleanupStep("remove-environment-db-stack", () => stackRemove(environmentStackName));
      await runNonFatalCleanupStep("remove-project-db-stack", () => stackRemove(projectStackName));
      await runNonFatalCleanupStep("remove-resource-db-stack", () => stackRemove(resourceStackName));
    });

    await step.run("cleanup-volume", async () => {
      await runNonFatalCleanupStep("remove-db-volume", () => removeVolume(databaseVolumeName));
    });

    logger.info(
      { resourceId, projectId },
      "Resource infrastructure cleanup completed",
    );

    return { success: true as const };
  },
);
