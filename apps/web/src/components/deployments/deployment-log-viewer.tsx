import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Skeleton } from "@otterstack/ui/components/ui/skeleton";

import { orpc } from "@/utils/orpc";

type DeploymentLogViewerProps = {
  deploymentId: string;
};

export function DeploymentLogViewer({ deploymentId }: DeploymentLogViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const logsQuery = useQuery(
    orpc.deployment.streamLogs.queryOptions({
      input: { deploymentId },
    }),
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logsQuery.data]);

  if (logsQuery.isLoading) {
    return <Skeleton className="h-64 rounded-lg" />;
  }

  const items = logsQuery.data?.items ?? [];

  return (
    <div
      ref={scrollRef}
      className="h-80 overflow-auto rounded-lg border bg-black p-4 font-mono text-xs text-green-400"
    >
      {items.length === 0 ? (
        <p className="text-muted-foreground">No logs available yet.</p>
      ) : (
        items.map((line, i) => (
          <div key={i}>{String(line)}</div>
        ))
      )}
    </div>
  );
}
