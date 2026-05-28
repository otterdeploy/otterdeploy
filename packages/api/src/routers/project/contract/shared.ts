/**
 * Constants shared across every domain slice of the project contract.
 *
 * `tag` controls how endpoints are grouped in the generated OpenAPI doc;
 * `basePath` is the URL prefix every route lives under so the slices can
 * compose paths without restating the prefix.
 */

import { ID_PREFIX, zId } from "@otterdeploy/shared/id";

export const tag = "project";
export const basePath = "/projects";

/** Stock error map for "this resource doesn't belong to your org or doesn't exist." */
export const projectNotFoundErrors = {
  NOT_FOUND: {
    status: 404 as const,
    message: "Project not found" as const,
  },
};

/** Same for inner-resource lookups under a project. */
export const resourceNotFoundErrors = {
  NOT_FOUND: {
    status: 404 as const,
    message: "Resource not found" as const,
  },
};

// ─── Field-level shared zod schemas ─────────────────────────────────
// `projectId: zId(ID_PREFIX.project)` was hand-rolled across 41 oRPC
// contract slices. Pull from here so every input shares the same
// brand + validation.

export const projectIdField = zId(ID_PREFIX.project);
export const resourceIdField = zId(ID_PREFIX.resource);
export const deploymentIdField = zId(ID_PREFIX.deployment);
export const environmentIdField = zId(ID_PREFIX.environment);
export const organizationIdField = zId(ID_PREFIX.organization);
export const proxyRouteIdField = zId(ID_PREFIX.proxyRoute);
export const containerRegistryIdField = zId(ID_PREFIX.containerRegistry);
export const gitProviderIdField = zId(ID_PREFIX.gitProvider);
export const gitInstallationIdField = zId(ID_PREFIX.gitInstallation);
export const gitRepoIdField = zId(ID_PREFIX.gitRepo);
export const serverIdField = zId(ID_PREFIX.server);
