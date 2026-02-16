import { Link } from "@tanstack/react-router";

import { DeploymentStatusBadge } from "./deployment-status-badge";

type DeploymentCardProps = {
  id: string;
  projectId: string;
  status: string;
  source: string;
  gitRef: string | null;
  gitCommitSha: string | null;
  gitCommitMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  duration: number | null;
  createdAt: string;
};

export function DeploymentCard({
  id,
  projectId,
  status,
  source,
  gitRef,
  gitCommitSha,
  gitCommitMessage,
  startedAt,
  duration,
  createdAt,
}: DeploymentCardProps) {
  const time = startedAt ?? createdAt;

  return (
    <Link
      to={`/projects/${projectId}/deployments/${id}`}
      className="flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/50"
    >
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2">
          <DeploymentStatusBadge status={status} />
          <span className="text-sm font-medium capitalize">{source.replace("_", " ")}</span>
        </div>
        {gitCommitMessage && (
          <p className="text-sm text-muted-foreground truncate">{gitCommitMessage}</p>
        )}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {gitRef && <span>{gitRef}</span>}
          {gitCommitSha && <span className="font-mono">{gitCommitSha.slice(0, 7)}</span>}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0 text-xs text-muted-foreground">
        <span>{new Date(time).toLocaleString()}</span>
        {duration != null && <span>{Math.round(duration)}s</span>}
      </div>
    </Link>
  );
}
