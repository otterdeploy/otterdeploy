import { useMemo } from "react";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Database02Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";

import { createResourceCollection } from "@/features/projects/data/resource";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/graph/$resourceId")({
  component: RouteComponent,
});

function RouteComponent() {
  const { resourceId } = Route.useParams();
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });
  const navigate = Route.useNavigate();

  const resourceCollection = useMemo(
    () => createResourceCollection(project.id),
    [project.id],
  );

  const { data: matches = [] } = useLiveQuery(
    (q) =>
      q
        .from({ r: resourceCollection })
        .where(({ r }) => eq(r.resourceId, resourceId)),
    [resourceId, resourceCollection],
  );

  const resource = matches[0] ?? null;
  const close = () => navigate({ to: "/$orgSlug/$projectSlug/graph" });

  return (
    <div className="pointer-events-auto h-full w-2/3 animate-in fade-in-0 slide-in-from-right-2 overflow-hidden rounded-2xl rounded-tr-none border border-r-0 border-border bg-background duration-200">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <Button variant="ghost" size="icon-sm" onClick={close} aria-label="Back">
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
        </Button>
        <div className="text-sm font-medium">
          {resource ? resource.name : "Resource"}
        </div>
        {resource && (
          <>
            <Badge variant="outline" className="font-mono text-[10px] uppercase">
              {resource.engine}
            </Badge>
            <RuntimeStatusBadge status={resource.runtime.status} />
          </>
        )}
        <div className="ml-auto" />
        <Button variant="ghost" size="icon-sm" onClick={close} aria-label="Close">
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
        </Button>
      </div>

      <div className="h-[calc(100%-3rem)] overflow-y-auto p-4">
        {resource ? (
          <ResourceBody resource={resource} />
        ) : (
          <NotFound id={resourceId} onClose={close} />
        )}
      </div>
    </div>
  );
}

function RuntimeStatusBadge({ status }: { status: string }) {
  const tone =
    status === "running"
      ? "bg-success/15 text-success border-success/30"
      : status === "starting"
        ? "bg-warning/15 text-warning border-warning/30"
        : status === "error"
          ? "bg-destructive/15 text-destructive border-destructive/30"
          : "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex h-5 items-center rounded-sm border px-2 text-[10px] font-medium uppercase tracking-wider ${tone}`}
    >
      {status}
    </span>
  );
}

function NotFound({ id, onClose }: { id: string; onClose: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <HugeiconsIcon
        icon={Database02Icon}
        strokeWidth={1.5}
        className="size-10 text-muted-foreground/40"
      />
      <div className="text-sm font-medium">Resource not found</div>
      <div className="max-w-sm text-xs text-muted-foreground">
        No resource with id <span className="font-mono">{id}</span> exists in this project.
        The graph still shows demo nodes — services and workers aren't backed by real data
        yet, only postgres databases created via the wizard are.
      </div>
      <Button variant="outline" size="sm" onClick={onClose}>
        Back to graph
      </Button>
    </div>
  );
}

// At present resourceSchema is a one-engine discriminated union (postgres).
// When more engines / types land, branch on resource.type / resource.engine
// and pull in engine-specific sections.
type ResourceBodyProps = {
  resource: {
    resourceId: string;
    name: string;
    engine: string;
    status: string;
    databaseName: string;
    username: string;
    password: string;
    publicHostname: string;
    publicPort: number;
    publicConnectionString: string;
    internalHostname: string;
    internalPort: number;
    internalConnectionString: string;
    localConnectionString: string | null;
    runtime: {
      serviceId: string | null;
      serviceName: string;
      volumeName: string;
      networkName: string;
      status: string;
      health: string | null;
    };
  };
};

function ResourceBody({ resource }: ResourceBodyProps) {
  return (
    <div className="flex flex-col gap-3">
      <Section title="Connection">
        <KV label="Database" value={resource.databaseName} mono />
        <KV label="Internal host" value={`${resource.internalHostname}:${resource.internalPort}`} mono />
        <KV label="Public host" value={`${resource.publicHostname}:${resource.publicPort}`} mono />
        <ReadOnlyField label="Internal connection string" value={resource.internalConnectionString} />
        <ReadOnlyField label="Public connection string" value={resource.publicConnectionString} />
        {resource.localConnectionString && (
          <ReadOnlyField label="Local connection string" value={resource.localConnectionString} />
        )}
      </Section>

      <Section title="Credentials">
        <KV label="Username" value={resource.username} mono />
        <ReadOnlyField label="Password" value={resource.password} secret />
      </Section>

      <Section title="Runtime">
        <KV label="Service" value={resource.runtime.serviceName} mono />
        <KV label="Status" value={resource.runtime.status} />
        {resource.runtime.health && <KV label="Health" value={resource.runtime.health} />}
        <KV label="Volume" value={resource.runtime.volumeName} mono />
        <KV label="Network" value={resource.runtime.networkName} mono />
        {resource.runtime.serviceId && (
          <KV label="Service ID" value={resource.runtime.serviceId} mono />
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="rounded-md">
      <CardContent className="flex flex-col gap-2.5 py-3">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          {title}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function KV({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 text-xs">
      <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-foreground" : "text-foreground"}>{value}</span>
    </div>
  );
}

function ReadOnlyField({
  label,
  value,
  secret = false,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <Input
        readOnly
        value={value}
        type={secret ? "password" : "text"}
        className="h-8 font-mono text-xs"
        onClick={(e) => (e.target as HTMLInputElement).select()}
      />
    </div>
  );
}
