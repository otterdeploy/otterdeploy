export type DeploymentStatus = "queued" | "building" | "deploying" | "success" | "failed" | "rolled-back";

export interface DeploymentRow {
  id: string;
  serviceName: string;
  commit: { sha: string; message: string };
  author: { name: string };
  status: DeploymentStatus;
  durationSeconds: number;
  startedAt: string;
}
