import { createSelectSchema } from "drizzle-zod";
import type { z } from "zod";

import { resource } from "./schema/project";
import { resourceRuntimeConfig, resourceBuildConfig } from "./schema/resource-config";
import { deployment } from "./schema/deployment";
import { project, environment } from "./schema/project";
import { gitRepository } from "./schema/infrastructure";
import { customDomain } from "./schema/operations";

// --- Zod select schemas (runtime-usable) ---

export const resourceSelectSchema = createSelectSchema(resource);
export const resourceRuntimeConfigSelectSchema = createSelectSchema(resourceRuntimeConfig);
export const resourceBuildConfigSelectSchema = createSelectSchema(resourceBuildConfig);
export const deploymentSelectSchema = createSelectSchema(deployment);
export const projectSelectSchema = createSelectSchema(project);
export const environmentSelectSchema = createSelectSchema(environment);
export const gitRepositorySelectSchema = createSelectSchema(gitRepository);
export const customDomainSelectSchema = createSelectSchema(customDomain);

// --- Inferred TypeScript types ---

export type ResourceSelect = z.infer<typeof resourceSelectSchema>;
export type ResourceRuntimeConfigSelect = z.infer<typeof resourceRuntimeConfigSelectSchema>;
export type ResourceBuildConfigSelect = z.infer<typeof resourceBuildConfigSelectSchema>;
export type DeploymentSelect = z.infer<typeof deploymentSelectSchema>;
export type ProjectSelect = z.infer<typeof projectSelectSchema>;
export type EnvironmentSelect = z.infer<typeof environmentSelectSchema>;
export type GitRepositorySelect = z.infer<typeof gitRepositorySelectSchema>;
export type CustomDomainSelect = z.infer<typeof customDomainSelectSchema>;
