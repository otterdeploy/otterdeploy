/**
 * The password-rotation handler, split out of
 * router-resource-postgres so that file stays under its line cap. Behaviour
 * lives in ./postgres/rotate-password: this is the transport binding plus the
 * audit diff.
 */

import { matchError } from "better-result";

import { recordSecretMapChanges } from "../../audit/changes";
import { requirePermission } from "../../index";
import { rotateDatabasePassword } from "./postgres/rotate-password";

export const postgresRotatePasswordHandler = requirePermission({
  database: ["update"],
}).project.resource.database.postgres.rotatePassword.handler(async ({ input, context, errors }) => {
  context.log.set({
    target: {
      type: "resource",
      kind: "postgres",
      id: input.resourceId,
      projectId: input.projectId,
    },
  });
  const result = await rotateDatabasePassword(
    {
      projectId: input.projectId,
      resourceId: input.resourceId,
      organizationId: context.activeOrganizationId,
      terminateSessions: input.terminateSessions,
    },
    context.log,
  );
  if (result.isErr()) {
    throw matchError(result.error, {
      ProjectNotFoundError: () => errors.NOT_FOUND(),
      PostgresResourceNotFoundError: () => errors.NOT_FOUND(),
      PasswordRotationUnsupportedError: (e) => errors.ROTATION_UNSUPPORTED({ message: e.message }),
      PasswordRotationFailedError: (e) => errors.ROTATION_FAILED({ message: e.message }),
    });
  }
  // The audit row names what changed and never a value: the credential and
  // both connection strings were replaced, plus one entry per service rolled.
  const rolled = Object.fromEntries(
    result.value.dependents.map((d) => [`rolled/${d.name}`, d.status]),
  );
  recordSecretMapChanges(context, {
    before: { password: "old", internalConnectionString: "old", publicConnectionString: "old" },
    after: {
      password: "new",
      internalConnectionString: "new",
      publicConnectionString: "new",
      ...rolled,
    },
  });
  return result.value;
});
