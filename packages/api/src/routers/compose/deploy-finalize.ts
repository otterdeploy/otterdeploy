import type { DeploymentId } from "@otterdeploy/shared/id";

/**
 * Stack-deploy completion: derive the stack-level outcome, log it, and settle
 * the deployment row when the caller owns it. Split from deploy.ts for the
 * file/complexity caps.
 */
import { markDeploymentFailed, markDeploymentRunning } from "../project/deployments";

export type StackDeployStatus = "running" | "failed" | "partial";

export async function finalizeStackDeployment(input: {
  depId: DeploymentId;
  ownsDeployment: boolean;
  deployed: number;
  failed: string[];
  total: number;
  log: (line: string) => void;
}): Promise<StackDeployStatus> {
  const { depId, ownsDeployment, deployed, failed, total, log } = input;
  const status: StackDeployStatus =
    failed.length === 0 ? "running" : deployed === 0 ? "failed" : "partial";
  log(
    failed.length === 0
      ? `Stack deploy complete: ${deployed}/${total} service(s) running.`
      : `Stack deploy ${status}: ${deployed} rolled out, failed: ${failed.join(", ")}`,
  );

  if (ownsDeployment) {
    if (status === "failed") {
      await markDeploymentFailed(depId, `No services deployed (${failed.join(", ")} failed)`);
    } else {
      await markDeploymentRunning(
        depId,
        failed.length > 0 ? `Some services failed: ${failed.join(", ")}` : null,
      );
    }
  }
  return status;
}
