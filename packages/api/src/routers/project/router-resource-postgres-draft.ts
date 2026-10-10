/**
 * The draft-credentials handler, split out of router-resource-postgres so that
 * router file stays under its line cap. Reads (and on first call mints) the
 * credentials a not-yet-provisioned database will deploy with.
 */

import { idSchema } from "@otterdeploy/shared/id";

import { requirePermission } from "../../index";
import { resolveRuntimeScope } from "../../lib/environment/runtime-scope";
import { scopeSuffix } from "../../lib/environment/scoping";
import { deriveInternalDbCredentials } from "./postgres/credentials";
import { ensureDraftCredentialPassword, getProjectInOrg } from "./queries";
import { resolveNewResourceEnvironment } from "./queries/new-resource-environment";

// Mints (and persists) the password the database about to be created will
// use, so it needs what that create needs, not just membership: a
// read-only key must not write it.
export const postgresDraftCredentialsHandler = requirePermission({
  database: ["create"],
}).project.resource.database.postgres.draftCredentials.handler(
  async ({ input, context, errors }) => {
    const project = await getProjectInOrg({
      projectId: input.projectId,
      organizationId: context.activeOrganizationId,
    });
    if (!project) throw errors.NOT_FOUND();
    // The environment must be this project's: the hostname suffix is derived
    // from its slug, so another project's environment (or a dangling id)
    // must not reach the derivation.
    const environmentId = await resolveNewResourceEnvironment(
      input.projectId,
      idSchema.environment.safeParse(input.environmentId).data ?? null,
    );
    if (environmentId.isErr()) throw errors.NOT_FOUND({ message: environmentId.error.message });
    // Mint (or read) the stable password, then derive the rest.
    const password = await ensureDraftCredentialPassword(input.projectId, input.name);
    // The SAME scope the create will apply, so what the pending panel shows
    // is what deploys (od-jwx). BASE for main and for a caller that sends no
    // environment, which is every pre-environment client.
    const suffix = scopeSuffix(
      await resolveRuntimeScope({
        projectId: input.projectId,
        environmentId: environmentId.value,
      }),
    );
    const creds = deriveInternalDbCredentials({
      engine: input.engine,
      projectSlug: project.slug,
      resourceName: input.name,
      password,
      scopeSuffix: suffix,
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
);
