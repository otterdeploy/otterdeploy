import { matchError } from "better-result";

import { orgScopedProcedure, requirePermission } from "../../index";
import {
  createPostgresResourceStream,
  restartDatabaseResource,
  setPostgresExtensions,
  setPostgresExtraEnvKey,
  setPostgresPublic,
  unsetPostgresExtraEnvKey,
  validatePostgresCreate,
} from "./handlers";
import { deriveInternalDbCredentials } from "./postgres/credentials";
import { ensureDraftCredentialPassword, getProjectInOrg } from "./queries";

export const postgresResourceRouter = {
  // Streaming create. Pre-flight validation (project lookup + name
  // conflict) happens BEFORE the stream opens — those failures throw
  // matched oRPC errors. Once the generator runs, runtime failures
  // surface as `error` events the wizard renders alongside the
  // already-completed steps.
  create: requirePermission({
    database: ["create"],
  }).project.resource.database.postgres.create.handler(
    // Eager prelude. Everything that should land in the audit wide
    // event has to run BEFORE we return the generator — once that
    // happens oRPC sets up the streaming response, hono's `next()`
    // resolves, and evlog flushes. Anything log.set() inside the
    // generator body gets dropped with a warning.
    async ({ input, context, errors }) => {
      context.log.set({
        target: {
          type: "resource",
          kind: "postgres",
          projectId: input.projectId,
          name: input.name,
        },
      });

      const validation = await validatePostgresCreate({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
        name: input.name,
      });
      if (validation.isErr()) {
        throw matchError(validation.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          PostgresResourceConflictError: () => errors.CONFLICT(),
        });
      }

      // The resource id only exists after the db-record step yields,
      // long after the wide event flushed. Clients still receive it
      // via the `created` event payload.
      return createPostgresResourceStream(
        {
          ...input,
          projectId: input.projectId,
          organizationId: context.activeOrganizationId,
          project: validation.value.project,
        },
        context.log,
      );
    },
  ),

  draftCredentials: orgScopedProcedure.project.resource.database.postgres.draftCredentials.handler(
    async ({ input, context, errors }) => {
      const project = await getProjectInOrg({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
      });
      if (!project) throw errors.NOT_FOUND();
      // Mint (or read) the stable password, then derive the rest.
      const password = await ensureDraftCredentialPassword(input.projectId, input.name);
      const creds = deriveInternalDbCredentials({
        engine: input.engine,
        projectSlug: project.slug,
        resourceName: input.name,
        password,
      });
      return {
        username: creds.username,
        password: creds.password,
        databaseName: creds.databaseName,
        internalHostname: creds.internalHostname,
        internalPort: creds.internalPort,
        internalConnectionString: creds.internalConnectionString,
      };
    },
  ),

  setPublic: requirePermission({
    database: ["update"],
  }).project.resource.database.postgres.setPublic.handler(async ({ input, context, errors }) => {
    context.log.set({
      target: {
        type: "resource",
        kind: "postgres",
        id: input.resourceId,
        projectId: input.projectId,
      },
    });
    const result = await setPostgresPublic(
      {
        projectId: input.projectId,
        resourceId: input.resourceId,
        publicEnabled: input.publicEnabled,
        organizationId: context.activeOrganizationId,
      },
      context.log,
    );
    if (result.isErr()) {
      throw matchError(result.error, {
        ProjectNotFoundError: () => errors.NOT_FOUND(),
        PostgresResourceNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    return result.value;
  }),

  restart: requirePermission({
    database: ["update"],
  }).project.resource.database.postgres.restart.handler(async ({ input, context, errors }) => {
    context.log.set({
      target: {
        type: "resource",
        kind: "postgres",
        id: input.resourceId,
        projectId: input.projectId,
      },
    });
    const result = await restartDatabaseResource(
      {
        projectId: input.projectId,
        resourceId: input.resourceId,
        organizationId: context.activeOrganizationId,
      },
      context.log,
    );
    if (result.isErr()) {
      throw matchError(result.error, {
        ProjectNotFoundError: () => errors.NOT_FOUND(),
        PostgresResourceNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    return result.value;
  }),

  setExtensions: requirePermission({
    database: ["update"],
  }).project.resource.database.postgres.setExtensions.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: {
          type: "resource",
          kind: "postgres",
          id: input.resourceId,
          projectId: input.projectId,
        },
      });
      const result = await setPostgresExtensions(
        {
          projectId: input.projectId,
          resourceId: input.resourceId,
          extensions: input.extensions,
          organizationId: context.activeOrganizationId,
        },
        context.log,
      );
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          PostgresResourceNotFoundError: () => errors.NOT_FOUND(),
          IncompatibleExtensionsError: (e) => errors.INVALID_INPUT({ message: e.message }),
        });
      }
      return result.value;
    },
  ),

  setExtraEnv: requirePermission({
    database: ["update"],
  }).project.resource.database.postgres.setExtraEnv.handler(async ({ input, context, errors }) => {
    context.log.set({
      target: {
        type: "resource",
        kind: "postgres",
        id: input.resourceId,
        projectId: input.projectId,
      },
      envKey: input.key,
    });
    const result = await setPostgresExtraEnvKey(
      {
        projectId: input.projectId,
        resourceId: input.resourceId,
        key: input.key,
        value: input.value,
        organizationId: context.activeOrganizationId,
      },
      context.log,
    );
    if (result.isErr()) {
      throw matchError(result.error, {
        ProjectNotFoundError: () => errors.NOT_FOUND(),
        PostgresResourceNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    return result.value;
  }),

  unsetExtraEnv: requirePermission({
    database: ["update"],
  }).project.resource.database.postgres.unsetExtraEnv.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: {
          type: "resource",
          kind: "postgres",
          id: input.resourceId,
          projectId: input.projectId,
        },
        envKey: input.key,
      });
      const result = await unsetPostgresExtraEnvKey(
        {
          projectId: input.projectId,
          resourceId: input.resourceId,
          key: input.key,
          organizationId: context.activeOrganizationId,
        },
        context.log,
      );
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          PostgresResourceNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),
};
