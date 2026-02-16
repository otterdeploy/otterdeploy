import type { InferContractRouterInputs, InferContractRouterOutputs } from "@orpc/contract";

import {
  architectureContract,
  auditContract,
  backupContract,
  deploymentContract,
  domainContract,
  environmentContract,
  environmentVariableContract,
  monitoringContract,
  projectContract,
  resourceContract,
  resourceLinkContract,
  serverContract,
  systemContract,
  teamContract,
} from "./contracts";

export const appContract = {
  project: projectContract,
  environment: environmentContract,
  resource: resourceContract,
  resourceLink: resourceLinkContract,
  architecture: architectureContract,
  deployment: deploymentContract,
  environmentVariable: environmentVariableContract,
  domain: domainContract,
  server: serverContract,
  monitoring: monitoringContract,
  backup: backupContract,
  team: teamContract,
  audit: auditContract,
  system: systemContract,
} as const;

export type AppContract = typeof appContract;
export type AppContractInputs = InferContractRouterInputs<AppContract>;
export type AppContractOutputs = InferContractRouterOutputs<AppContract>;
