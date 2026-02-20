import { ORPCError } from "@orpc/server";
import { db, eq, and } from "@otterdeploy/db";
import {
  project,
  projectEnvironment,
  projectResource,
  projectResourceLink,
} from "@otterdeploy/db/schema/architecture";
import { deployment } from "@otterdeploy/db/schema/deployment";
import { server, gitProvider } from "@otterdeploy/db/schema/infrastructure";
import { customDomain, backup, environmentVariable } from "@otterdeploy/db/schema/operations";
import { secretReference } from "@otterdeploy/db/schema/secrets";

export async function validateProjectAccess(projectId: string, organizationId: string) {
  const row = await db.query.project.findFirst({
    where: and(eq(project.id, projectId), eq(project.organizationId, organizationId)),
  });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Project not found" });
  return row;
}

export async function validateEnvironmentAccess(environmentId: string, organizationId: string) {
  const row = await db.query.projectEnvironment.findFirst({
    where: eq(projectEnvironment.id, environmentId),
    with: { project: true },
  });
  if (!row || row.project.organizationId !== organizationId) {
    throw new ORPCError("NOT_FOUND", { message: "Environment not found" });
  }
  return row;
}

/** Validate environment belongs to the specified project AND org. */
export async function validateEnvironmentInProject(
  environmentId: string,
  projectId: string,
  organizationId: string,
) {
  const row = await db.query.projectEnvironment.findFirst({
    where: and(
      eq(projectEnvironment.id, environmentId),
      eq(projectEnvironment.projectId, projectId),
    ),
    with: { project: true },
  });
  if (!row || row.project.organizationId !== organizationId) {
    throw new ORPCError("NOT_FOUND", { message: "Environment not found in project" });
  }
  return row;
}

export async function validateResourceAccess(resourceId: string, organizationId: string) {
  const row = await db.query.projectResource.findFirst({
    where: eq(projectResource.id, resourceId),
    with: {
      environment: {
        with: { project: true },
      },
    },
  });
  if (!row || row.environment.project.organizationId !== organizationId) {
    throw new ORPCError("NOT_FOUND", { message: "Resource not found" });
  }
  return row;
}

/** Validate resource belongs to the specified environment, project, AND org. */
export async function validateResourceInProject(
  resourceId: string,
  environmentId: string,
  projectId: string,
  organizationId: string,
) {
  const row = await db.query.projectResource.findFirst({
    where: and(
      eq(projectResource.id, resourceId),
      eq(projectResource.environmentId, environmentId),
    ),
    with: {
      environment: {
        with: { project: true },
      },
    },
  });
  if (
    !row ||
    row.environment.projectId !== projectId ||
    row.environment.project.organizationId !== organizationId
  ) {
    throw new ORPCError("NOT_FOUND", { message: "Resource not found in project/environment" });
  }
  return row;
}

export async function validateDeploymentAccess(deploymentId: string, organizationId: string) {
  const row = await db.query.deployment.findFirst({
    where: and(eq(deployment.id, deploymentId), eq(deployment.organizationId, organizationId)),
  });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Deployment not found" });
  return row;
}

export async function validateServerAccess(serverId: string, organizationId: string) {
  const row = await db.query.server.findFirst({
    where: and(eq(server.id, serverId), eq(server.organizationId, organizationId)),
  });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Server not found" });
  return row;
}

export async function validateGitProviderAccess(providerId: string, organizationId: string) {
  const row = await db.query.gitProvider.findFirst({
    where: and(eq(gitProvider.id, providerId), eq(gitProvider.organizationId, organizationId)),
  });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Git provider not found" });
  return row;
}

export async function validateDomainAccess(domainId: string, organizationId: string) {
  const row = await db.query.customDomain.findFirst({
    where: and(eq(customDomain.id, domainId), eq(customDomain.organizationId, organizationId)),
  });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Domain not found" });
  return row;
}

export async function validateBackupAccess(backupId: string, organizationId: string) {
  const row = await db.query.backup.findFirst({
    where: and(eq(backup.id, backupId), eq(backup.organizationId, organizationId)),
  });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Backup not found" });
  return row;
}

export async function validateEnvVarAccess(variableId: string, organizationId: string) {
  const row = await db.query.environmentVariable.findFirst({
    where: and(
      eq(environmentVariable.id, variableId),
      eq(environmentVariable.organizationId, organizationId),
    ),
  });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Environment variable not found" });
  return row;
}

export async function validateResourceLinkAccess(linkId: string, organizationId: string) {
  const row = await db.query.projectResourceLink.findFirst({
    where: eq(projectResourceLink.id, linkId),
    with: {
      environment: {
        with: { project: true },
      },
    },
  });
  if (!row || row.environment.project.organizationId !== organizationId) {
    throw new ORPCError("NOT_FOUND", { message: "Resource link not found" });
  }
  return row;
}

export async function validateSecretReferenceAccess(referenceId: string, organizationId: string) {
  const row = await db.query.secretReference.findFirst({
    where: and(
      eq(secretReference.id, referenceId),
      eq(secretReference.organizationId, organizationId),
    ),
  });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Secret reference not found" });
  return row;
}
