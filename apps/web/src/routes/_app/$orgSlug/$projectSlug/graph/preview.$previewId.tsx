/**
 * PR-preview detail panel — slides in from the right when a preview satellite
 * is clicked. Tabbed: Overview (identity + URL + per-service status),
 * Deployments (preview-scoped history → the existing deployment detail panel
 * with build/deploy logs), Variables (effective env per service: inherited base
 * vars + this preview's overrides, revertable), and Settings (rebuild/redeploy,
 * pause/resume, teardown, keep-alive/TTL, DB branch toggle + reset).
 */
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useLoaderData, useNavigate } from "@tanstack/react-router";
import * as m from "motion/react-client";
import { toast } from "sonner";

import { ArrowUpRight01Icon, Cancel01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Tabs, TabsContent, TabsContents, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/graph/preview/$previewId")({
  staticData: { crumb: "Preview" },
  component: PreviewPanel,
});

type PanelParams = ReturnType<typeof Route.useParams>;

const badgeBase =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-none font-medium";
const label = "font-mono text-[10.5px] font-medium tracking-[0.18em] text-muted-foreground uppercase";

const STATUS_PILL: Record<string, string> = {
  running: "bg-success/12 text-success",
  starting: "bg-warning/12 text-warning",
  building: "bg-warning/12 text-warning",
  pending: "bg-warning/12 text-warning",
  crashed: "bg-destructive/12 text-destructive",
  failed: "bg-destructive/12 text-destructive",
};
const pillClass = (s: string) => STATUS_PILL[s] ?? "bg-muted text-muted-foreground";

type Preview = Awaited<ReturnType<typeof orpc.project.previews.list.call>>[number];
type PreviewService = Preview["services"][number];

function PreviewPanel() {
  const { orgSlug, projectSlug, previewId } = Route.useParams();
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });
  const navigate = useNavigate();

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
        <header className="flex items-center gap-3 border-b border-border/60 px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-[15px] font-semibold tabular-nums">
                {preview ? `#${preview.prNumber}` : "…"}
              </span>
              <span className={label}>preview</span>
              {preview ? (
                <span
                  className={cn(
                    badgeBase,
                    preview.paused
                      ? "bg-muted text-muted-foreground"
                      : preview.state === "active"
                        ? "bg-success/12 text-success"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {preview.paused ? "paused" : preview.state}
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
        </header>

        {!preview && !previews.isLoading ? (
          <p className="px-6 py-5 text-sm text-muted-foreground">
            This preview is gone — its PR was likely closed.
          </p>
        ) : preview ? (
          <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col gap-0">
            <div className="border-b border-border/60 px-6">
              <TabsList variant="line" className="h-auto bg-transparent p-0">
                <TabsTrigger value="overview" className="px-2.5 py-2.5">
                  Overview
                </TabsTrigger>
                <TabsTrigger value="deployments" className="px-2.5 py-2.5">
                  Deployments
                </TabsTrigger>
                <TabsTrigger value="variables" className="px-2.5 py-2.5">
                  Variables
                </TabsTrigger>
                <TabsTrigger value="settings" className="px-2.5 py-2.5">
                  Settings
                </TabsTrigger>
              </TabsList>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <TabsContents>
                <TabsContent value="overview">
                  <OverviewTab preview={preview} />
                </TabsContent>
                <TabsContent value="deployments">
                  {preview.services.map((svc) => (
                    <DeploymentHistory
                      key={svc.resourceId}
                      orgSlug={orgSlug}
                      projectSlug={projectSlug}
                      projectId={project.id}
                      previewId={previewId}
                      service={svc}
                    />
                  ))}
                </TabsContent>
                <TabsContent value="variables">
                  {preview.services.map((svc) => (
                    <VariablesTab
                      key={svc.resourceId}
                      projectId={project.id}
                      previewId={previewId}
                      service={svc}
                    />
                  ))}
                </TabsContent>
                <TabsContent value="settings">
                  <SettingsTab projectId={project.id} preview={preview} />
                </TabsContent>
              </TabsContents>
            </div>
          </Tabs>
        ) : null}
      </div>
    </m.div>
  );
}

function OverviewTab({ preview }: { preview: Preview }) {
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
        <dt className={label}>branch</dt>
        <dd className="font-mono text-foreground/90">{preview.branch}</dd>
        <dt className={label}>commit</dt>
        <dd className="font-mono text-foreground/90">{preview.headSha.slice(0, 12)}</dd>
        <dt className={label}>db</dt>
        <dd>{preview.dbBranched ? "isolated branch" : "shared with base"}</dd>
        <dt className={label}>expires</dt>
        <dd>
          {preview.autoTeardownAt
            ? new Date(preview.autoTeardownAt).toLocaleString()
            : "pinned (keep-alive)"}
        </dd>
      </dl>
      <div>
        <div className={label}>services</div>
        <ul className="mt-2 divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
          {preview.services.map((svc) => (
            <li key={svc.resourceId} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                {svc.serviceName}
              </span>
              {svc.url ? (
                <a
                  href={svc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate font-mono text-[11.5px] text-muted-foreground hover:text-foreground"
                >
                  {svc.url.replace(/^https?:\/\//, "")}
                </a>
              ) : null}
              {svc.deployedSha ? (
                <span
                  className="shrink-0 font-mono text-[11px] text-muted-foreground"
                  title={`Deployed commit ${svc.deployedSha}`}
                >
                  {svc.deployedSha.slice(0, 7)}
                </span>
              ) : null}
              <span className={cn(badgeBase, pillClass(svc.status))}>
                <span className="size-1.5 rounded-full bg-current" />
                {svc.status === "none" ? "queued" : svc.status}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DeploymentHistory(props: {
  orgSlug: PanelParams["orgSlug"];
  projectSlug: PanelParams["projectSlug"];
  projectId: string;
  previewId: string;
  service: PreviewService;
}) {
  const { orgSlug, projectSlug, projectId, previewId, service } = props;
  const deployments = useQuery(
    orpc.project.resource.deployments.list.queryOptions({
      input: { projectId, resourceId: service.resourceId, previewId },
      refetchInterval: 5_000,
    }),
  );
  const rows = deployments.data ?? [];

  return (
    <div className="mb-6">
      <div className={label}>{service.serviceName}</div>
      {rows.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted-foreground">
          {deployments.isLoading ? "Loading…" : "No preview deployments yet."}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
          {rows.map((d) => (
            <li key={d.id}>
              <Link
                to="/$orgSlug/$projectSlug/graph/$resourceId/deployment/$deploymentId"
                params={{
                  orgSlug,
                  projectSlug: projectSlug as never,
                  resourceId: service.resourceId,
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

function VariablesTab(props: { projectId: string; previewId: string; service: PreviewService }) {
  const { projectId, previewId, service } = props;
  const queryClient = useQueryClient();
  const scope = { projectId, previewId, serviceResourceId: service.resourceId };
  const effOptions = orpc.project.previews.envVars.effective.queryOptions({
    input: scope,
    refetchInterval: 5_000,
  });
  const eff = useQuery(effOptions);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: effOptions.queryKey });

  const set = useMutation(
    orpc.project.previews.envVars.set.mutationOptions({
      onSuccess: invalidate,
      onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to set override"),
    }),
  );
  const unset = useMutation(
    orpc.project.previews.envVars.unset.mutationOptions({
      onSuccess: invalidate,
      onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to revert"),
    }),
  );

  const form = useForm({
    defaultValues: { key: "", value: "" },
    onSubmit: async ({ value: v }) => {
      try {
        await set.mutateAsync({ ...scope, key: v.key.trim(), value: v.value });
        form.reset();
      } catch {
        /* toast fired */
      }
    },
  });

  const rows = eff.data ?? [];

  return (
    <div className="mb-6">
      <div className={label}>{service.serviceName}</div>
      <div className="mt-2 overflow-hidden rounded-lg border border-border/60">
        <div className="grid grid-cols-[1fr_1.4fr_auto] items-center gap-3 border-b border-border/60 bg-muted/30 px-3 py-1.5">
          <span className={label}>key</span>
          <span className={label}>value</span>
          <span className={label}>source</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-3 py-2 text-[13px] text-muted-foreground">
            {eff.isLoading ? "Loading…" : "No variables."}
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {rows.map((row) => (
              <li
                key={row.key}
                className="grid grid-cols-[1fr_1.4fr_auto] items-center gap-3 px-3 py-2"
              >
                <span className="truncate font-mono text-[12.5px] font-medium">{row.key}</span>
                <span
                  className={cn(
                    "truncate font-mono text-[12.5px]",
                    row.source === "override" ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {row.value}
                </span>
                {row.source === "override" ? (
                  <span className="flex items-center gap-1.5">
                    <span className={cn(badgeBase, "bg-info/12 text-info")}>override</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Revert ${row.key} to inherited`}
                      title={row.baseValue ? `Revert to base: ${row.baseValue}` : "Remove override"}
                      disabled={unset.isPending}
                      onClick={() => unset.mutate({ ...scope, key: row.key })}
                    >
                      <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
                    </Button>
                  </span>
                ) : (
                  <span className={cn(badgeBase, "bg-muted text-muted-foreground")}>inherited</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

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
                <em className="text-[11px] not-italic text-destructive">
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
              placeholder="value (overrides the inherited one)"
              className="h-8 flex-1 font-mono text-[12px]"
              aria-label="Override value"
            />
          )}
        </form.Field>
        <form.Subscribe
          selector={(st) => ({ canSubmit: st.canSubmit, submitting: st.isSubmitting })}
        >
          {({ canSubmit, submitting }) => (
            <Button type="submit" variant="outline" size="sm" disabled={!canSubmit || submitting}>
              {submitting ? "…" : "Add override"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </div>
  );
}

function SettingsTab({ projectId, preview }: { projectId: string; preview: Preview }) {
  const queryClient = useQueryClient();
  const scope = { projectId, previewId: preview.id };
  const invalidatePreviews = () =>
    void queryClient.invalidateQueries({
      queryKey: orpc.project.previews.list.queryKey({ input: { projectId } }),
    });

  const rebuild = useMutation(
    orpc.project.previews.rebuild.mutationOptions({
      onSuccess: () => {
        invalidatePreviews();
        toast.success("Rebuild queued");
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Rebuild failed"),
    }),
  );
  const redeploy = useMutation(
    orpc.project.previews.redeploy.mutationOptions({
      onSuccess: () => {
        invalidatePreviews();
        toast.success("Redeployed");
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Redeploy failed"),
    }),
  );
  const pause = useMutation(
    orpc.project.previews.pause.mutationOptions({
      onSuccess: () => {
        invalidatePreviews();
        toast.success("Preview paused");
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Pause failed"),
    }),
  );
  const resume = useMutation(
    orpc.project.previews.resume.mutationOptions({
      onSuccess: () => {
        invalidatePreviews();
        toast.success("Preview resumed");
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Resume failed"),
    }),
  );
  const teardown = useMutation(
    orpc.project.previews.teardown.mutationOptions({
      onSuccess: () => {
        invalidatePreviews();
        toast.success("Preview torn down");
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Teardown failed"),
    }),
  );
  const keepAlive = useMutation(
    orpc.project.previews.keepAlive.mutationOptions({
      onSuccess: () => {
        invalidatePreviews();
        toast.success("Keep-alive updated");
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
    }),
  );
  const dbEnable = useMutation(
    orpc.project.previews.dbBranch.enable.mutationOptions({
      onSuccess: () => {
        invalidatePreviews();
        toast.success("Database branched");
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Branch failed"),
    }),
  );
  const dbDisable = useMutation(
    orpc.project.previews.dbBranch.disable.mutationOptions({
      onSuccess: () => {
        invalidatePreviews();
        toast.success("Now using base DB");
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
    }),
  );
  const dbReset = useMutation(
    orpc.project.previews.dbBranch.reset.mutationOptions({
      onSuccess: () => {
        invalidatePreviews();
        toast.success("Database re-seeded");
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Re-seed failed"),
    }),
  );

  const pinned = preview.autoTeardownAt === null;

  return (
    <div className="flex flex-col gap-6">
      <Section title="Build">
        <Row desc="Rebuild from the PR head commit.">
          <Button
            variant="outline"
            size="sm"
            disabled={rebuild.isPending}
            onClick={() => rebuild.mutate(scope)}
          >
            Rebuild
          </Button>
        </Row>
        <Row desc="Roll the running containers from the last built image.">
          <Button
            variant="outline"
            size="sm"
            disabled={redeploy.isPending}
            onClick={() => redeploy.mutate(scope)}
          >
            Redeploy
          </Button>
        </Row>
      </Section>

      <Section title="Lifecycle">
        <Row
          desc={
            preview.paused
              ? "Preview is paused — resume to bring it back."
              : "Stop containers, keep the preview and its URL."
          }
        >
          {preview.paused ? (
            <Button
              variant="outline"
              size="sm"
              disabled={resume.isPending}
              onClick={() => resume.mutate(scope)}
            >
              Resume
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={pause.isPending}
              onClick={() => pause.mutate(scope)}
            >
              Pause
            </Button>
          )}
        </Row>
        <Row
          desc={
            pinned
              ? "Pinned — never idle-torn-down."
              : `Idle teardown ${preview.autoTeardownAt ? new Date(preview.autoTeardownAt).toLocaleString() : ""}.`
          }
        >
          <Button
            variant="outline"
            size="sm"
            disabled={keepAlive.isPending}
            onClick={() => keepAlive.mutate({ ...scope, keepAlive: !pinned })}
          >
            {pinned ? "Enable idle teardown" : "Keep alive (pin)"}
          </Button>
        </Row>
        <Row desc="Tear down this preview now (does not close the PR).">
          <Button
            variant="outline"
            size="sm"
            className="text-destructive"
            disabled={teardown.isPending}
            onClick={() => teardown.mutate(scope)}
          >
            Tear down
          </Button>
        </Row>
      </Section>

      <Section title="Database">
        {preview.dbBranched ? (
          <Row desc="This preview runs on an isolated DB branch.">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={dbReset.isPending}
                onClick={() => dbReset.mutate(scope)}
              >
                Re-seed
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={dbDisable.isPending}
                onClick={() => dbDisable.mutate(scope)}
              >
                Use base DB
              </Button>
            </div>
          </Row>
        ) : preview.branchableDbCount > 0 ? (
          <Row desc="This preview shares the base database. Branch it for isolation.">
            <Button
              variant="outline"
              size="sm"
              disabled={dbEnable.isPending}
              onClick={() => dbEnable.mutate(scope)}
            >
              Branch database
            </Button>
          </Row>
        ) : (
          <Row desc="This preview's services don't connect to a platform database — nothing to branch." />
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className={label}>{title}</div>
      <div className="mt-2 divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
        {children}
      </div>
    </section>
  );
}

function Row({ desc, children }: { desc: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-3 py-3">
      <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">{desc}</p>
      {children}
    </div>
  );
}
