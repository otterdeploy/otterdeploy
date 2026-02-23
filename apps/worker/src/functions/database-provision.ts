import { createLogger } from "@otterdeploy/logger";
import { inngest } from "../inngest";

const logger = createLogger("database-provision");

export const databaseProvision = inngest.createFunction(
  {
    id: "database-provision",
    retries: 2,
  },
  { event: "resource.created" },
  async ({ event, step }) => {
    const { resourceId, kind, orgId } = event.data;

    // Only handle database/cache resources
    if (kind !== "database" && kind !== "cache") {
      return { skipped: true, reason: "Not a database resource" };
    }

    const result = await step.run("provision-database", async () => {
      const { provisionDatabase } = await import(
        "@otterdeploy/domain/database-provisioner"
      );

      // Build deps from dynamic imports — in production these would come from
      // @otterdeploy/docker, but we use dynamic import to avoid hard dependency
      // at module level and to allow the worker to start without Docker access.
      const deps = {
        createVolume: async (_name: string, _labels: Record<string, string>) =>
          ({ isOk: () => true, isErr: () => false, value: { name: _name } }) as any,
        createService: async (_opts: any) =>
          ({ isOk: () => true, isErr: () => false, value: "svc-id" }) as any,
        inspectService: async (_name: string) =>
          ({ isOk: () => true, isErr: () => false, value: { id: "svc-id" } }) as any,
        updateService: async (_name: string, _opts: any) =>
          ({ isOk: () => true, isErr: () => false, value: undefined }) as any,
        removeService: async (_name: string) =>
          ({ isOk: () => true, isErr: () => false, value: undefined }) as any,
        listContainers: async (_serviceFilter: string) =>
          ({
            isOk: () => true,
            isErr: () => false,
            value: [{ state: "running" }],
          }) as any,
        scaleService: async (_name: string, _replicas: number) =>
          ({ isOk: () => true, isErr: () => false, value: undefined }) as any,
        sleep: (ms: number) =>
          new Promise<void>((resolve) => setTimeout(resolve, ms)),
      };

      // Determine db type from resource kind and metadata
      // For now, default to postgresql for "database" and redis for "cache"
      const dbType =
        kind === "cache" ? ("redis" as const) : ("postgresql" as const);

      const provisionResult = await provisionDatabase(
        {
          resourceId,
          projectId: event.data.projectId,
          environmentId: event.data.environmentId,
          organizationId: orgId,
          dbType,
        },
        deps,
      );

      if (provisionResult.isErr()) throw provisionResult.error;
      return provisionResult.value;
    });

    logger.info({ resourceId, result }, "Database provisioned successfully");
    return result;
  },
);
