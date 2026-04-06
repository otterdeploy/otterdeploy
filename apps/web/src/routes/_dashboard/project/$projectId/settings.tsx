import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Globe,
  Loader2,
  Network,
  Plus,
  X,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { client, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/_dashboard/project/$projectId/settings")({
  component: RouteComponent,
});

type PostgresResource = {
  resourceId: string;
  name: string;
  status: "draft" | "valid" | "invalid";
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
    containerName: string;
    volumeName: string;
    networkName: string;
    hostPort: number | null;
    status: "running" | "starting" | "stopped" | "missing" | "error";
    health: "healthy" | "unhealthy" | "starting" | null;
  };
};

type ProxyRoute = {
  id: string;
  projectId: string;
  resourceId: string | null;
  type: "http" | "layer4";
  domain: string;
  upstreamHost: string;
  upstreamPort: number;
  protocol: "tcp" | "http";
  layer4Alpn: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

function RouteComponent() {
  const { projectId } = Route.useParams();
  const navigate = Route.useNavigate();

  const databaseQuery = useQuery({
    queryKey: ["project-databases", projectId],
    queryFn: () => client.project.database.listPostgres({ projectId }),
  });

  const proxyRouteQuery = useQuery({
    queryKey: ["project-proxy-routes", projectId],
    queryFn: () => client.project.proxyRoute.list({ projectId }),
  });

  const [databaseName, setDatabaseName] = useState("");

  const createDatabaseMutation = useMutation({
    mutationFn: async () =>
      client.project.database.createPostgres({
        projectId,
        name: databaseName.trim(),
      }),
    onSuccess: async () => {
      setDatabaseName("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project-databases", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["project-proxy-routes", projectId] }),
      ]);
    },
  });

  const databases = databaseQuery.data ?? [];
  const proxyRoutes = proxyRouteQuery.data ?? [];
  const latestCreatedDatabase = createDatabaseMutation.data;
  const createDatabaseErrorMessage =
    createDatabaseMutation.error instanceof Error ? createDatabaseMutation.error.message : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/24 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-3xl flex-col border-l border-border bg-background/96 shadow-2xl">
        <div className="flex items-start gap-4 px-6 py-5">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold tracking-tight">Project Settings</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Manage databases and proxy routes for this project.
            </p>
          </div>
          <Button
            className="ml-auto"
            onClick={() => navigate({ to: "/project/$projectId", params: { projectId } })}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X className="size-4" />
          </Button>
        </div>

        <Separator />

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-5">
            <Card>
              <CardHeader>
                <CardTitle>Project Databases</CardTitle>
                <CardDescription>
                  Create a dedicated Postgres container for this project. Each database gets a
                  Docker container, credentials, and a Caddy proxy route for public access.
                </CardDescription>
              </CardHeader>
              <div className="grid gap-4 px-6 pb-6">
                <form
                  className="grid gap-3 rounded-2xl border border-border/80 bg-muted/30 p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!databaseName.trim() || createDatabaseMutation.isPending) {
                      return;
                    }
                    createDatabaseMutation.mutate();
                  }}
                >
                  <div className="grid gap-2">
                    <Label htmlFor="project-database-name">Database name</Label>
                    <Input
                      id="project-database-name"
                      onChange={(event) => setDatabaseName(event.target.value)}
                      placeholder="primary"
                      value={databaseName}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">
                      Creates a Postgres container, generates credentials, and configures a Caddy
                      proxy route for public TLS access.
                    </p>
                    <Button
                      disabled={!databaseName.trim() || createDatabaseMutation.isPending}
                      type="submit"
                    >
                      {createDatabaseMutation.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Plus className="size-4" />
                      )}
                      Create Postgres DB
                    </Button>
                  </div>
                </form>

                {createDatabaseErrorMessage ? (
                  <Alert variant="error">
                    <AlertCircle />
                    <AlertTitle>Database creation failed</AlertTitle>
                    <AlertDescription>{createDatabaseErrorMessage}</AlertDescription>
                  </Alert>
                ) : null}

                {latestCreatedDatabase ? (
                  <Alert variant={latestCreatedDatabase.status === "valid" ? "success" : "warning"}>
                    {latestCreatedDatabase.status === "valid" ? <CheckCircle2 /> : <AlertCircle />}
                    <AlertTitle>
                      {latestCreatedDatabase.status === "valid"
                        ? "Database created and proxy route applied"
                        : "Database created but proxy route failed"}
                    </AlertTitle>
                    <AlertDescription>
                      <span>
                        {latestCreatedDatabase.localConnectionString ??
                          latestCreatedDatabase.publicConnectionString}
                      </span>
                      {latestCreatedDatabase.status !== "valid" ? (
                        <span className="block mt-1">
                          The Caddy reconciler could not apply the proxy route. Check that Caddy is
                          running and accessible at the configured admin URL.
                        </span>
                      ) : null}
                    </AlertDescription>
                  </Alert>
                ) : null}

                {databaseQuery.isError ? (
                  <Alert variant="error">
                    <AlertCircle />
                    <AlertTitle>Failed to load project databases</AlertTitle>
                    <AlertDescription>
                      {databaseQuery.error instanceof Error
                        ? databaseQuery.error.message
                        : "Unable to load the current database resources."}
                    </AlertDescription>
                  </Alert>
                ) : null}

                <div className="grid gap-3">
                  {databaseQuery.isLoading ? (
                    <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      Loading project databases...
                    </div>
                  ) : databases.length > 0 ? (
                    databases.map((database) => (
                      <DatabaseCard
                        key={database.resourceId}
                        database={database}
                        proxyRoute={proxyRoutes.find((r) => r.resourceId === database.resourceId)}
                      />
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                      No Postgres databases yet. Create one above and it will show up here with its
                      connection details.
                    </div>
                  )}
                </div>
              </div>
            </Card>

            {proxyRoutes.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Proxy Routes</CardTitle>
                  <CardDescription>
                    Active Caddy proxy routes for this project. These are managed automatically when
                    resources are created.
                  </CardDescription>
                </CardHeader>
                <div className="grid gap-2 px-6 pb-6">
                  {proxyRoutes.map((route) => (
                    <ProxyRouteRow key={route.id} route={route} />
                  ))}
                </div>
              </Card>
            ) : null}

            {proxyRouteQuery.isError ? (
              <Alert variant="error">
                <AlertCircle />
                <AlertTitle>Failed to load proxy routes</AlertTitle>
                <AlertDescription>
                  {proxyRouteQuery.error instanceof Error
                    ? proxyRouteQuery.error.message
                    : "Unable to load proxy routes."}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProxyRouteRow({ route }: { route: ProxyRoute }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/80 bg-muted/20 px-4 py-3">
      <Badge variant={route.enabled ? "success" : "warning"}>
        {route.enabled ? "active" : "disabled"}
      </Badge>
      <Badge variant="outline">{route.type}</Badge>
      <code className="text-sm">{route.domain}</code>
      <span className="text-muted-foreground text-sm">→</span>
      <code className="text-sm text-muted-foreground">
        {route.upstreamHost}:{route.upstreamPort}
      </code>
      {route.layer4Alpn ? (
        <Badge variant="outline" className="ml-auto">{route.layer4Alpn}</Badge>
      ) : null}
    </div>
  );
}

function DatabaseCard({
  database,
  proxyRoute,
}: {
  database: PostgresResource;
  proxyRoute?: ProxyRoute;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-muted/30">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-muted-foreground" />
            <CardTitle>{database.name}</CardTitle>
          </div>
          <Badge variant={getStatusVariant(database.status)}>{database.status}</Badge>
          <Badge variant={getRuntimeVariant(database.runtime.status)}>
            {database.runtime.status}
          </Badge>
        </div>
        <CardDescription>
          Database `{database.databaseName}` backed by container `{database.runtime.containerName}`.
        </CardDescription>
      </CardHeader>
      <div className="grid gap-4 px-6 py-5">
        {database.runtime.status !== "running" ? (
          <Alert variant="warning">
            <AlertCircle />
            <AlertTitle>Container is not fully healthy yet</AlertTitle>
            <AlertDescription>
              Docker reports this Postgres runtime as `{database.runtime.status}`
              {database.runtime.health ? ` (${database.runtime.health})` : ""}.
            </AlertDescription>
          </Alert>
        ) : null}

        {database.status !== "valid" ? (
          <Alert variant="warning">
            <AlertCircle />
            <AlertTitle>Public ingress is not live</AlertTitle>
            <AlertDescription>
              {!proxyRoute ? (
                <span>
                  No proxy route exists for this database. This can happen if the database was
                  created before the Caddy rework. Delete and recreate the database to provision a
                  proxy route.
                </span>
              ) : (
                <span>
                  A proxy route exists for `{proxyRoute.domain}` but the Caddy reconciler failed to
                  apply it. Make sure Caddy is running and accessible at the admin URL, then try
                  creating a new resource to trigger reconciliation.
                </span>
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-2">
          <InfoRow
            icon={Globe}
            label="Public host"
            value={`${database.publicHostname}:${database.publicPort}`}
          />
          <InfoRow
            icon={Network}
            label="Local host"
            value={
              database.runtime.hostPort === null
                ? "Port unavailable"
                : `127.0.0.1:${database.runtime.hostPort}`
            }
          />
          <InfoRow icon={Database} label="Username" value={database.username} />
          <InfoRow icon={Database} label="Container" value={database.runtime.containerName} />
        </div>

        <ConnectionBlock label="Public connection string" value={database.publicConnectionString} />
        {database.localConnectionString ? (
          <ConnectionBlock
            label="Local connection string"
            value={database.localConnectionString}
          />
        ) : null}
        <ConnectionBlock
          label="Internal connection string"
          value={database.internalConnectionString}
        />
        <ConnectionBlock label="Password" value={database.password} />
      </div>
    </Card>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Globe;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border/80 bg-muted/20 p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </div>
      <code className="mt-2 block break-all text-sm">{value}</code>
    </div>
  );
}

function ConnectionBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <pre className="overflow-x-auto rounded-2xl border border-border/80 bg-muted/20 px-4 py-3 text-xs leading-6 sm:text-sm">
        <code>{value}</code>
      </pre>
    </div>
  );
}

function getStatusVariant(status: "draft" | "valid" | "invalid") {
  switch (status) {
    case "valid":
      return "success" as const;
    case "invalid":
      return "error" as const;
    default:
      return "warning" as const;
  }
}

function getRuntimeVariant(status: "running" | "starting" | "stopped" | "missing" | "error") {
  switch (status) {
    case "running":
      return "success" as const;
    case "starting":
      return "warning" as const;
    case "stopped":
    case "missing":
    case "error":
      return "error" as const;
    default:
      return "warning" as const;
  }
}
