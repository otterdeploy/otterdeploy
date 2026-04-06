import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, CheckCircle2, Loader2, RotateCcw, Save, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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

function RouteComponent() {
  const { projectId } = Route.useParams();
  const navigate = Route.useNavigate();

  const query = useQuery({
    queryKey: ["project-caddy", projectId],
    queryFn: () => client.project.caddy.get({ projectId }),
  });

  const [draft, setDraft] = useState<DraftState>({
    httpCaddyfile: "",
    layer4Caddyfile: "",
  });
  const [isDirty, setIsDirty] = useState(false);

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

  const currentConfig = saveMutation.data?.config ?? query.data;
  const validationErrors = saveMutation.data?.validationErrors ?? [];
  const statusVariant = getStatusVariant(currentConfig?.status ?? "draft");
  const queryErrorMessage =
    query.error instanceof Error ? query.error.message : "Unable to load the project config.";
  const saveErrorMessage =
    saveMutation.error instanceof Error ? saveMutation.error.message : null;
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
            onClick={() => navigate({ to: "/project/$projectId/layout", params: { projectId } })}
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
                  This file is imported inside otterstack’s global `layer4` block. Use project-only
                  listeners and SNI claims.
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
                  placeholder={":5432 {\n\t@project tls sni db.example.com\n\troute @project {\n\t\tproxy 10.0.0.20:5432\n\t}\n}"}
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
