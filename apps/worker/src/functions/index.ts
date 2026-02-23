import { deploymentPipeline } from "./deployment-pipeline";
import { deploymentRollback } from "./deployment-rollback";
import { deploymentCancel } from "./deployment-cancel";

export const functions = [deploymentPipeline, deploymentRollback, deploymentCancel];
