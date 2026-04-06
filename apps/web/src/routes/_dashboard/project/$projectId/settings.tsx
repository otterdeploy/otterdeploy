import { useEffect, useMemo, useState } from "react";
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
  RotateCcw,
  Save,
  X,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { client, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/_dashboard/project/$projectId/settings")({
  component: RouteComponent,
});

type DraftState = {
  httpCaddyfile: string;
  layer4Caddyfile: string;
};

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

function RouteComponent() {
  const { projectId } = Route.useParams();
  const navigate = Route.useNavigate();

  const query = useQuery({
    queryKey: ["project-caddy", projectId],
    queryFn: () => client.project.caddy.get({ projectId }),
  });
  const databaseQuery = useQuery({
    queryKey: ["project-databases", projectId],
    queryFn: () => client.project.database.listPostgres({ projectId }),
  });

  const [draft, setDraft] = useState<DraftState>({
    httpCaddyfile: "",
    layer4Caddyfile: "",
  });
  const [isDirty, setIsDirty] = useState(false);
  const [databaseName, setDatabaseName] = useState("");

  useEffect(() => {
    if (query.data && !isDirty) {
      setDraft({
        httpCaddyfile: query.data.httpCaddyfile,
        layer4Caddyfile: query.data.layer4Caddyfile,
      });
    }
  }, [isDirty, query.data]);

  const saveMutation = useMutation({
    mutationFn: async () =>
      client.project.caddy.save({
        projectId,
        httpCaddyfile: draft.httpCaddyfile,
        layer4Caddyfile: draft.layer4Caddyfile,
      }),
    onSuccess: async (result) => {
      setIsDirty(false);
      setDraft({
        httpCaddyfile: result.config.httpCaddyfile,
        layer4Caddyfile: result.config.layer4Caddyfile,
      });
      await queryClient.invalidateQueries({ queryKey: ["project-caddy", projectId] });
    },
  });
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
        queryClient.invalidateQueries({ queryKey: ["project-caddy", projectId] }),
      ]);
    },
  });

  const currentConfig = saveMutation.data?.config ?? query.data;
  const validationErrors = saveMutation.data?.validationErrors ?? [];
  const statusVariant = getStatusVariant(currentConfig?.status ?? "draft");
  const queryErrorMessage =
    query.error instanceof Error ? query.error.message : "Unable to load the project config.";
  const saveErrorMessage =
    saveMutation.error instanceof Error ? saveMutation.error.message : null;
  const createDatabaseErrorMessage =
    createDatabaseMutation.error instanceof Error ? createDatabaseMutation.error.message : null;
  const hasUnsavedChanges =
    isDirty &&
    (!!query.data &&
      (draft.httpCaddyfile !== query.data.httpCaddyfile ||
        draft.layer4Caddyfile !== query.data.layer4Caddyfile));

  const lastErrorLines = useMemo(() => {
    const error = currentConfig?.lastError ?? "";
    return error
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }, [currentConfig?.lastError]);
  const databases = databaseQuery.data ?? [];
  const latestCreatedDatabase = createDatabaseMutation.data;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/24 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-3xl flex-col border-l border-border bg-background/96 shadow-2xl">
        <div className="flex items-start gap-4 px-6 py-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">Project Caddy Config</h2>
              <Badge variant={statusVariant}>{currentConfig?.status ?? "draft"}</Badge>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Edit project-scoped `http.caddy` and `layer4.caddy` files. Otterstack validates the
              draft, writes staged files, runs Caddy adapt/load, and only promotes valid configs.
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
                  Create a dedicated Postgres container for this project and get the public Caddy
                  endpoint plus a directly usable local connection string.
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
                      One click creates the container, credentials, public hostname, local port,
                      and managed `layer4` snippet.
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
                      {latestCreatedDatabase.runtime.status === "running"
                        ? "Container created and started"
                        : "Container created with runtime warnings"}
                    </AlertTitle>
                    <AlertDescription>
                      <span>
                        {latestCreatedDatabase.localConnectionString ??
                          latestCreatedDatabase.publicConnectionString}
                      </span>
                      {latestCreatedDatabase.status !== "valid" ? (
                        <span>
                          The database exists, but the project Caddy config needs a manual fix
                          before the public hostname becomes live.
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
                      <DatabaseCard key={database.resourceId} database={database} />
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                      No Postgres databases yet. Create one above and it will show up here with its
                      public and internal connection details.
                    </div>
                  )}
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Runtime Paths</CardTitle>
                <CardDescription>
                  Otterstack owns the generated root wrapper and writes project files into the
                  managed Caddy directory.
                </CardDescription>
              </CardHeader>
              <div className="grid gap-3 px-6 pb-6 text-sm">
                <PathRow label="Root Caddyfile" value={currentConfig?.paths.rootCaddyfile ?? "—"} />
                <PathRow
                  label="Project directory"
                  value={currentConfig?.paths.projectDirectory ?? "—"}
                />
                <PathRow
                  label="HTTP file"
                  value={currentConfig?.paths.httpCaddyfile ?? "—"}
                />
                <PathRow
                  label="Layer4 file"
                  value={currentConfig?.paths.layer4Caddyfile ?? "—"}
                />
                <PathRow label="Project slug" value={currentConfig?.projectSlug ?? "—"} />
                <PathRow
                  label="Last applied revision"
                  value={currentConfig?.lastAppliedRevision ?? "Not applied yet"}
                />
                <PathRow
                  label="Last applied at"
                  value={currentConfig?.lastAppliedAt ?? "Not applied yet"}
                />
              </div>
            </Card>

            {query.isError ? (
              <Alert variant="error">
                <AlertCircle />
                <AlertTitle>Failed to load project config</AlertTitle>
                <AlertDescription>{queryErrorMessage}</AlertDescription>
              </Alert>
            ) : null}

            {saveErrorMessage ? (
              <Alert variant="error">
                <AlertCircle />
                <AlertTitle>Failed to save draft</AlertTitle>
                <AlertDescription>{saveErrorMessage}</AlertDescription>
              </Alert>
            ) : null}

            {validationErrors.length > 0 || lastErrorLines.length > 0 ? (
              <Alert variant="error">
                <AlertCircle />
                <AlertTitle>Validation failed</AlertTitle>
                <AlertDescription>
                  {(validationErrors.length > 0 ? validationErrors : lastErrorLines).map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </AlertDescription>
              </Alert>
            ) : null}

            {!query.isLoading && currentConfig?.status === "valid" ? (
              <Alert variant="success">
                <CheckCircle2 />
                <AlertTitle>Live config is healthy</AlertTitle>
                <AlertDescription>
                  The most recent valid draft was adapted and loaded successfully.
                </AlertDescription>
              </Alert>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>HTTP Caddyfile</CardTitle>
                <CardDescription>
                  Use hostname-based site blocks only. Global options belong to the otterstack root
                  wrapper.
                </CardDescription>
              </CardHeader>
              <div className="px-6 pb-6">
                <Label htmlFor="project-http-caddy">`http.caddy`</Label>
                <Textarea
                  className="mt-2 font-mono text-sm"
                  id="project-http-caddy"
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, httpCaddyfile: event.target.value }));
                    setIsDirty(true);
                  }}
                  placeholder={`app.${projectId}.otterstack.local {\n\treverse_proxy 127.0.0.1:3000\n}`}
                  rows={16}
                  value={draft.httpCaddyfile}
                />
              </div>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Layer4 Caddyfile</CardTitle>
                <CardDescription>
                  This file is imported into otterstack’s TLS listener wrapper. Add project-only
                  Postgres or TCP routing rules, not top-level listeners.
                </CardDescription>
              </CardHeader>
              <div className="px-6 pb-6">
                <Label htmlFor="project-layer4-caddy">`layer4.caddy`</Label>
                <Textarea
                  className="mt-2 font-mono text-sm"
                  id="project-layer4-caddy"
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, layer4Caddyfile: event.target.value }));
                    setIsDirty(true);
                  }}
                  placeholder={"@project tls {\n\talpn postgresql\n\tsni db.example.com\n}\nroute @project {\n\ttls {\n\t\tconnection_policy {\n\t\t\talpn postgresql\n\t\t}\n\t}\n\tproxy db.internal:5432\n}"}
                  rows={16}
                  value={draft.layer4Caddyfile}
                />
              </div>
              <CardFooter className="flex items-center justify-between gap-3 border-t bg-muted/40 px-6 py-4">
                <div className="text-sm text-muted-foreground">
                  {hasUnsavedChanges ? "Unsaved changes" : "Draft matches the latest saved project config"}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    disabled={!query.data || !hasUnsavedChanges || saveMutation.isPending}
                    onClick={() => {
                      if (!query.data) {
                        return;
                      }

                      setDraft({
                        httpCaddyfile: query.data.httpCaddyfile,
                        layer4Caddyfile: query.data.layer4Caddyfile,
                      });
                      setIsDirty(false);
                    }}
                    type="button"
                    variant="outline"
                  >
                    <RotateCcw className="size-4" />
                    Reset
                  </Button>
                  <Button
                    disabled={query.isLoading || saveMutation.isPending || !hasUnsavedChanges}
                    onClick={() => saveMutation.mutate()}
                    type="button"
                  >
                    {saveMutation.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Save className="size-4" />
                    )}
                    Save And Apply
                  </Button>
                </div>
              </CardFooter>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[170px_1fr] sm:items-start">
      <div className="text-muted-foreground">{label}</div>
      <code className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs sm:text-sm">
        {value}
      </code>
    </div>
  );
}

function DatabaseCard({ database }: { database: PostgresResource }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-muted/30">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-muted-foreground" />
            <CardTitle>{database.name}</CardTitle>
          </div>
          <Badge variant={getStatusVariant(database.status)}>{database.status}</Badge>
          <Badge variant={getRuntimeVariant(database.runtime.status)}>{database.runtime.status}</Badge>
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
            <AlertTitle>Public ingress is not live yet</AlertTitle>
            <AlertDescription>
              The database was created, but the generated Caddy snippet did not validate cleanly in
              the current project config.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-2">
          <InfoRow icon={Globe} label="Public host" value={`${database.publicHostname}:${database.publicPort}`} />
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
          <ConnectionBlock label="Local connection string" value={database.localConnectionString} />
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
