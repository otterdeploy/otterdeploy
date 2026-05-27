/**
 * Public surface for the project contract.
 *
 * Implementation is split by domain across files in this folder:
 *   - project.ts       project CRUD
 *   - resource.ts      generic resource schemas + list / get / delete / env / etc.
 *   - logs.ts          resource log + task log streaming
 *   - deployments.ts   deployment history schemas + sub-router
 *   - postgres.ts      postgres-specific create / setPublic / env writers
 *   - proxy.ts         caddy proxy routes
 *   - dependencies.ts  resource dependency edges
 *   - service-tasks.ts swarm task schemas + serviceTasks query
 *   - shared.ts        tag / basePath / common error maps
 *
 * Importers should always go through this barrel — the file layout can
 * keep evolving without touching call sites.
 */

import { dependenciesContractSlice } from "./dependencies";
import { deploymentsContractSlice } from "./deployments";
import { logsContractSlice } from "./logs";
import { postgresContractSlice } from "./postgres";
import { projectContractSlice } from "./project";
import { projectLogsContractSlice } from "./project-logs";
import { proxyContractSlice } from "./proxy";
import { resourceContractSlice } from "./resource";
import { serviceTasksContractSlice } from "./service-tasks";

export const projectContract = {
  ...projectContractSlice,
  proxyRoute: proxyContractSlice,
  dependencies: dependenciesContractSlice,
  serviceTasks: serviceTasksContractSlice,
  ...projectLogsContractSlice,
  resource: {
    ...resourceContractSlice,
    ...logsContractSlice,
    deployments: deploymentsContractSlice,
    database: {
      postgres: postgresContractSlice,
    },
  },
};

// ─── Re-exports of every schema / input ────────────────────────────────
// Callers across the codebase still import named schemas from the contract
// module — keep that surface stable here so the split is transparent.

export {
  createProjectInput,
  deleteProjectInput,
  getProjectBySlugInput,
  getProjectInput,
  projectListItemSchema,
  projectSchema,
  updateProjectInput,
} from "./project";

export {
  checkResourceNameInput,
  checkResourceNameSchema,
  databaseResourceSchema,
  deleteProjectResourceInput,
  getProjectResourceInput,
  listProjectResourcesInput,
  postgresResourceSchema,
  resourceEnvBulkSetInput,
  resourceEnvEntrySchema,
  resourceEnvListInput,
  resourceSchema,
  resourceTaskInput,
  serviceResourceSchema,
} from "./resource";

export {
  resourceLogEventSchema,
  resourceLogsTailInput,
  resourceTaskLogsTailInput,
} from "./logs";

export {
  projectLogEventSchema,
  projectLogsTailInput,
} from "./project-logs";

export {
  deploymentListInput,
  deploymentLogsTailInput,
  deploymentSchema,
  deploymentTasksInput,
} from "./deployments";

export {
  createPostgresDatabaseInput,
  createPostgresProgressSchema,
  deletePostgresDatabaseInput,
  getPostgresDatabaseInput,
  listPostgresDatabasesInput,
  setPostgresExtraEnvInput,
  setPostgresPublicInput,
  unsetPostgresExtraEnvInput,
} from "./postgres";

export {
  listProxyRoutesInput,
  proxyRouteSchema,
  reconcileResultSchema,
} from "./proxy";

export {
  dependencyEdgeSchema,
  listDependenciesInput,
} from "./dependencies";

export {
  listServiceTasksInput,
  serviceTaskSchema,
  serviceTasksSchema,
} from "./service-tasks";
