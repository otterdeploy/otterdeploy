/**
 * PR-preview detail panel — slides in from the right when a preview satellite
 * card is clicked. Shows the preview's identity (PR, branch, state, URL),
 * each service's preview deployment history (rows link to the existing
 * deployment detail panel, which carries the build/deploy logs), and the
 * per-preview env override editor. Overrides apply only inside this preview
 * and roll the preview container immediately when a built image exists.
 */
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useLoaderData, useNavigate } from "@tanstack/react-router";
import * as m from "motion/react-client";

import { ArrowUpRight01Icon, Cancel01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import { toast } from "sonner";

import { orpc } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/graph/preview/$previewId")({
  staticData: { crumb: "Preview" },
  component: PreviewPanel,
});

const badgeBase =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-none font-medium";

const STATUS_PILL: Record<string, string> = {
  running: "bg-success/12 text-success",
  starting: "bg-warning/12 text-warning",
  building: "bg-warning/12 text-warning",
  pending: "bg-warning/12 text-warning",
  crashed: "bg-destructive/12 text-destructive",
  failed: "bg-destructive/12 text-destructive",
};

function pillClass(status: string): string {
  return STATUS_PILL[status] ?? "bg-muted text-muted-foreground";
}

function PreviewPanel() {
  const { orgSlug, projectSlug, previewId } = Route.useParams();
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });
  const navigate = useNavigate();

  // Same query the graph polls — shared cache, so the panel opens instantly.
  const previews = useQuery(
    orpc.project.previews.list.queryOptions({
      input: { projectId: project.id },
      refetchInterval: 5_000,
    }),
  );
  const preview = (previews.data ?? []).find((p) => p.id === previewId);

  const close = () =>
    void navigate({ to: "/$orgSlug/$projectSlug/graph", params: { orgSlug, projectSlug } });

  const url = preview?.services.find((s) => s.url)?.url ?? null;

  return (
    <m.div
      key={previewId}
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      className="pointer-events-auto relative h-full w-full rounded-lg rounded-tr-none border border-r-0 border-border bg-card lg:w-4/5 xl:w-3/5"
    >
      <div className="flex h-full flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border/60 px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-[15px] font-semibold tabular-nums">
                {preview ? `#${preview.prNumber}` : "…"}
              </span>
              <span className="font-mono text-[10.5px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
                preview
              </span>
              {preview ? (
                <span
                  className={cn(
                    badgeBase,
                    preview.state === "active"
                      ? "bg-success/12 text-success"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {preview.state}
                </span>
              ) : null}
            </div>
            {preview ? (
              <div className="mt-0.5 truncate font-mono text-[12.5px] text-muted-foreground">
                {preview.branch}
              </div>
            ) : null}
          </div>
          {url ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => window.open(url, "_blank", "noopener")}
            >
              Open preview
              <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={2} className="size-3.5" />
            </Button>
          ) : null}
          <Button variant="ghost" size="icon-sm" onClick={close} aria-label="Close panel">
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {!preview && !previews.isLoading ? (
            <p className="text-sm text-muted-foreground">
              This preview is gone — its PR was likely closed.
            </p>
          ) : null}
          {preview?.services.map((svc) => (
            <ServiceSection
              key={svc.resourceId}
              orgSlug={orgSlug}
              projectSlug={projectSlug}
              projectId={project.id}
              previewId={previewId}
              service={svc}
            />
          ))}
        </div>
      </div>
    </m.div>
  );
}

type PanelParams = ReturnType<typeof Route.useParams>;

interface PreviewService {
  resourceId: string;
  serviceName: string;
  status: string;
  url: string | null;
}

function ServiceSection(props: {
  orgSlug: PanelParams["orgSlug"];
  projectSlug: PanelParams["projectSlug"];
  projectId: string;
  previewId: string;
  service: PreviewService;
}) {
  const { orgSlug, projectSlug, projectId, previewId, service } = props;

  return (
    <section className="mb-8">
      <div className="flex items-center gap-2.5">
        <h2 className="text-[14px] font-semibold">{service.serviceName}</h2>
        <span className={cn(badgeBase, pillClass(service.status))}>
          <span className="size-1.5 rounded-full bg-current" />
          {service.status === "none" ? "queued" : service.status}
        </span>
      </div>

      <DeploymentHistory
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        projectId={projectId}
        previewId={previewId}
        resourceId={service.resourceId}
      />

      <OverridesEditor projectId={projectId} previewId={previewId} resourceId={service.resourceId} />
    </section>
  );
}

function DeploymentHistory(props: {
  orgSlug: PanelParams["orgSlug"];
  projectSlug: PanelParams["projectSlug"];
  projectId: string;
  previewId: string;
  resourceId: string;
}) {
  const { orgSlug, projectSlug, projectId, previewId, resourceId } = props;
  const deployments = useQuery(
    orpc.project.resource.deployments.list.queryOptions({
      input: { projectId, resourceId, previewId },
      refetchInterval: 5_000,
    }),
  );
  const rows = deployments.data ?? [];

  return (
    <div className="mt-3">
      <div className="font-mono text-[10.5px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
        deployments
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted-foreground">
          {deployments.isLoading ? "Loading…" : "No preview deployments yet."}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
          {rows.map((d) => (
            <li key={d.id}>
              {/* Links into the EXISTING deployment detail panel — build +
                  deploy logs live there, fully reused for preview rows. */}
              <Link
                to="/$orgSlug/$projectSlug/graph/$resourceId/deployment/$deploymentId"
                params={{
                  orgSlug,
                  projectSlug: projectSlug as never,
                  resourceId,
                  deploymentId: d.id,
                }}
                search={{ tab: "details", previewId }}
                className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50"
              >
                <span className={cn(badgeBase, pillClass(d.status))}>
                  <span className="size-1.5 rounded-full bg-current" />
                  {d.status}
                </span>
                <span className="font-mono text-[12px] text-muted-foreground">
                  {d.gitSha ? d.gitSha.slice(0, 7) : d.image.split(":").pop()?.slice(0, 12)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
                  {d.reason}
                </span>
                <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground/70">
                  {new Date(d.createdAt).toLocaleString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OverridesEditor(props: { projectId: string; previewId: string; resourceId: string }) {
  const { projectId, previewId, resourceId } = props;
  const queryClient = useQueryClient();

  const scope = { projectId, previewId, serviceResourceId: resourceId };
  const listOptions = orpc.project.previews.envVars.list.queryOptions({ input: scope });
  const overrides = useQuery(listOptions);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: listOptions.queryKey });

  const set = useMutation(
    orpc.project.previews.envVars.set.mutationOptions({
      onSuccess: invalidate,
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "Failed to set override"),
    }),
  );
  const unset = useMutation(
    orpc.project.previews.envVars.unset.mutationOptions({
      onSuccess: invalidate,
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "Failed to remove override"),
    }),
  );

  const form = useForm({
    defaultValues: { key: "", value: "" },
    onSubmit: async ({ value: v }) => {
      try {
        await set.mutateAsync({ ...scope, key: v.key.trim(), value: v.value });
        form.reset();
      } catch {
        // onError already surfaced a toast; keep the form values for a retry.
      }
    },
  });

  return (
    <div className="mt-5">
      <div className="font-mono text-[10.5px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
        env overrides
      </div>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        Apply only inside this preview. Setting one rolls the preview with its latest build.
      </p>

      {(overrides.data ?? []).length > 0 ? (
        <ul className="mt-2 divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
          {(overrides.data ?? []).map((row) => (
            <li key={row.key} className="flex items-center gap-3 px-3 py-2">
              <span className="font-mono text-[12.5px] font-medium">{row.key}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-muted-foreground">
                {row.value}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove override ${row.key}`}
                disabled={unset.isPending}
                onClick={() => unset.mutate({ ...scope, key: row.key })}
              >
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className="mt-2 flex items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.Field
          name="key"
          validators={{
            onChange: ({ value: v }) =>
              v.trim().length === 0
                ? "Required"
                : /^[A-Za-z_][A-Za-z0-9_]*$/.test(v.trim())
                  ? undefined
                  : "Letters, digits and _ only",
          }}
        >
          {(field) => (
            <div className="flex max-w-44 flex-col gap-1">
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="KEY"
                className="h-8 font-mono text-[12px]"
                aria-label="Override key"
              />
              {field.state.meta.isTouched && field.state.meta.errors.length > 0 ? (
                <em className="text-[11px] text-destructive not-italic">
                  {field.state.meta.errors.join(", ")}
                </em>
              ) : null}
            </div>
          )}
        </form.Field>
        <form.Field name="value">
          {(field) => (
            <Input
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="value"
              className="h-8 flex-1 font-mono text-[12px]"
              aria-label="Override value"
            />
          )}
        </form.Field>
        <form.Subscribe selector={(s) => ({ canSubmit: s.canSubmit, submitting: s.isSubmitting })}>
          {({ canSubmit, submitting }) => (
            <Button type="submit" variant="outline" size="sm" disabled={!canSubmit || submitting}>
              {submitting ? "Applying…" : "Set"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </div>
  );
}
