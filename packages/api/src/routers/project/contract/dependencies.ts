/**
 * Resource dependency graph — derived from `${{<Resource>.<VAR>}}` references
 * inside service env vars. Service A consuming POSTGRES.URL emits the edge
 * `{ source: A, target: POSTGRES }`.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";

import { ID_PREFIX, zId } from "@otterstack/shared/id";

import { basePath, projectNotFoundErrors, tag } from "./shared";

export const dependencyEdgeSchema = z.object({
  source: zId(ID_PREFIX.resource),
  target: zId(ID_PREFIX.resource),
});

export const listDependenciesInput = z.object({
  projectId: zId(ID_PREFIX.project),
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
