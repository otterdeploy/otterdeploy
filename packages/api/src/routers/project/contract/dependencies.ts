/**
 * Resource dependency graph — derived from `${{<Resource>.<VAR>}}` references
 * inside service env vars. Service A consuming POSTGRES.URL emits the edge
 * `{ source: A, target: POSTGRES }`.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";

import { basePath, projectNotFoundErrors, tag } from "./shared";
import { projectIdField, resourceIdField } from "./shared";

const dependencyEdgeSchema = z.object({
  projectId: projectIdField,
  source: resourceIdField,
  target: resourceIdField,
});

const listDependenciesInput = z.object({
  projectId: projectIdField,
});

export const dependenciesContractSlice = oc
  .errors(projectNotFoundErrors)
  .meta({
    path: `${basePath}/{projectId}/dependencies`,
    tag,
    method: "GET",
  })
  .input(listDependenciesInput)
  .output(z.array(dependencyEdgeSchema));
