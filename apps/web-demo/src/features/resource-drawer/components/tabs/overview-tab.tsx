import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";

import { DatabaseLogo } from "@/components/brand/database-logo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { client } from "@/utils/orpc";

interface Props {
  projectId: string;
  resourceId: string;
}

export function OverviewTab({ projectId, resourceId }: Props) {
  const query = useQuery({
    queryKey: ["project-database", projectId, resourceId],
    queryFn: () => client.project.database.postgres.get({ projectId, resourceId }),
  });

  if (query.isLoading) {
    return (
      <div className="grid gap-3 p-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Alert variant="error" className="m-4">
        <AlertCircle />
        <AlertTitle>Couldn't load database</AlertTitle>
        <AlertDescription>
          {query.error instanceof Error ? query.error.message : "Unknown error"}
        </AlertDescription>
      </Alert>
    );
  }

  const db = query.data;
  return (
    <div className="grid gap-4 p-4">
      <div className="flex items-center gap-2">
        <DatabaseLogo value={db.name} size={16} />
        <span className="text-sm font-medium">{db.name}</span>
        <Badge
          className="ml-auto"
          variant={db.runtime.status === "running" ? "success" : "warning"}
        >
          {db.runtime.status}
        </Badge>
      </div>

      <Field label="Public host" value={`${db.publicHostname}:${db.publicPort}`} />
      <Field label="Internal host" value={`${db.internalHostname}:${db.internalPort}`} />
      <Field label="Username" value={db.username} />
      <CodeBlock label="Public connection string" value={db.publicConnectionString} />
      <CodeBlock label="Internal connection string" value={db.internalConnectionString} />
      {db.localConnectionString ? (
        <CodeBlock label="Local connection string" value={db.localConnectionString} />
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
      <code className="rounded bg-muted px-2 py-1 text-xs break-all">{value}</code>
    </div>
  );
}

function CodeBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
      <pre className="overflow-x-auto rounded bg-muted px-2 py-2 text-[11px] leading-5">
        <code>{value}</code>
      </pre>
    </div>
  );
}
