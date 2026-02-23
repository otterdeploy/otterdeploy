import { deploymentPipeline } from "./deployment-pipeline";
import { deploymentRollback } from "./deployment-rollback";
import { deploymentCancel } from "./deployment-cancel";
import { databaseProvision } from "./database-provision";
import { databaseUpgrade } from "./database-upgrade";
import { domainVerification } from "./domain-verification";
import { sslMonitor } from "./ssl-monitor";
import { serverHealthMonitor } from "./server-health";

export const functions = [
  deploymentPipeline,
  deploymentRollback,
  deploymentCancel,
  databaseProvision,
  databaseUpgrade,
  domainVerification,
  sslMonitor,
  serverHealthMonitor,
];
