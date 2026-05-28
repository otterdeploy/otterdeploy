import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ProjectId, ProjectSlug } from "@otterdeploy/shared/id";
import { useStore } from "@tanstack/react-form";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { getDatabaseEngine } from "@otterdeploy/shared/database-engines";
import { formatBytes } from "@otterdeploy/shared/format";

import { SERVICE_KINDS } from "@/features/projects/data/service-kinds";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

import { useStageManifestChange } from "../../hooks/use-manifest-stage";
import { flowFor } from "./flows";
import { useAppForm } from "./form-context";
import { resourceDefaults, resourceFormSchema, type Step } from "./schemas";
import {
  StepAdvancedDb,
  StepBuilder,
  StepImage,
  StepKind,
  StepNetworking,
  StepResources,
  StepReview,
  StepSource,
  StepStorage,
  StepVariables,
  StepVersion,
  Stepper,
} from "./steps";

export interface ResourceWizardProps {
  orgSlug: string;
  projectSlug: ProjectSlug;
  projectId: ProjectId;
  projectName: string;
  /** Seed for the `repo` form field — the project's current binding.
   *  Passed once at form construction so StepSource's bound/unbound
   *  state derives from form state (reactive) instead of a query. */
  initialGitRepoId?: string | null;
  /** Seed for the `branch` form field; defaults to "main". */
  initialBranch?: string | null;
  initialKind?: string | null;
  initialStep?: Step;
  onComplete?: () => void;
  onCancel?: () => void;
}

interface BodyProps extends ResourceWizardProps {
  layout: "page" | "dialog";
  step: Step;
  goTo: (next: Step) => void;
}

// Page-layout entry point: step lives in `?step=` search param.
export function PageResourceWizard(props: ResourceWizardProps) {
  const search = useSearch({
    from: "/_app/$orgSlug/$projectSlug/new-resource",
  });
  const navigate = useNavigate();
  const step = search.step ?? "kind";
  const goTo = (next: Step) =>
    void navigate({
      to: "/$orgSlug/$projectSlug/new-resource",
      params: { orgSlug: props.orgSlug, projectSlug: props.projectSlug },
      search: (s) => ({ ...s, step: next }),
    });
  return (
    <ResourceWizardBody {...props} layout="page" step={step} goTo={goTo} />
  );
}

// Dialog-layout entry point: step lives in local state.
export function DialogResourceWizard(props: ResourceWizardProps) {
  const [step, setStep] = useState<Step>(props.initialStep ?? "kind");
  return (
    <ResourceWizardBody {...props} layout="dialog" step={step} goTo={setStep} />
  );
}

function ResourceWizardBody({
  orgSlug,
  projectSlug,
  projectId,
  projectName,
  initialKind = null,
  initialGitRepoId = null,
  initialBranch = null,
  onComplete,
  onCancel,
  layout,
  step,
  goTo,
}: BodyProps) {
  usePrefetchSourceData(initialGitRepoId ?? null);

  // Provisioner state + create mutators (database + service) hoisted
  // into a hook so this component stays under the file-length cap.
  const { progress, runDatabaseCreate, runServiceCreate } =
    useResourceProvisioner({ projectId, projectSlug, onComplete });

  const {
    form,
    kind,
    kindId,
    isDb,
    isSourceBased,
    isDocker,
    steps,
    idx,
    isLast,
    failingSteps,
    currentStepIssues,
    handleContinue,
    goPrev,
  } = useWizardForm({
    step,
    goTo,
    layout,
    initialKind,
    initialGitRepoId,
    initialBranch,
    runDatabaseCreate,
    runServiceCreate,
  });

  const showChrome = layout === "page";
  const isCreating = progress.status === "running";
  const kindWired = isKindWired(kindId, kind);
  const createDisabled = isLast && (!kindWired || isCreating);

  return (
    <form.AppForm>
      <div
        className={`flex h-full flex-col text-foreground ${layout === "page" ? "bg-background" : "bg-transparent"}`}
      >
        {showChrome && (
          <WizardTopBar
            orgSlug={orgSlug}
            projectSlug={projectSlug}
            projectName={projectName}
            kindName={kind?.name ?? null}
            stepIdx={idx}
            stepCount={steps.length}
          />
        )}

        <Stepper
          steps={steps}
          idx={idx}
          setStep={goTo}
          failingSteps={failingSteps}
        />

        <WizardStepBody
          layout={layout}
          step={step}
          kind={kind}
          isDb={isDb}
          isSourceBased={isSourceBased}
          isDocker={isDocker}
          projectId={projectId}
          isLast={isLast}
          progress={progress}
        />

        {currentStepIssues.length > 0 && (
          <RequiredHint layout={layout} issues={currentStepIssues} />
        )}

        <WizardFooter
          layout={layout}
          orgSlug={orgSlug}
          projectSlug={projectSlug}
          onCancel={onCancel}
          idx={idx}
          isLast={isLast}
          isCreating={isCreating}
          kind={kind}
          kindWired={kindWired}
          createDisabled={createDisabled}
          goPrev={goPrev}
          handleContinue={handleContinue}
        />
      </div>
    </form.AppForm>
  );
}

// Which kinds the wizard actually knows how to submit. Hoisted out of
// the body so the 6-way disjunction doesn't pad ResourceWizardBody's
// cyclomatic complexity past the cap. Add new kinds here as their
// flows ship.
const WIRED_DB_KINDS = new Set(["postgres", "redis", "mariadb", "mongodb"]);
function isKindWired(
  kindId: string,
  kind: (typeof SERVICE_KINDS)[number] | null,
): boolean {
  if (kindId === "docker") return true;
  if (WIRED_DB_KINDS.has(kindId)) return true;
  return kind?.group === "compute";
}

// ─── Render helpers ─────────────────────────────────────────────────────
// Pulled out of ResourceWizardBody so it stays under the file-length
// cap. Each helper is a pure presentational component over the wizard
// state the body already computed; no hooks live in this band.

function WizardTopBar({
  orgSlug,
  projectSlug,
  projectName,
  kindName,
  stepIdx,
  stepCount,
}: {
  orgSlug: string;
  projectSlug: ProjectSlug;
  projectName: string;
  kindName: string | null;
  stepIdx: number;
  stepCount: number;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b bg-card px-5 py-3">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
        render={() => (
          <Link to="/$orgSlug/$projectSlug" params={{ orgSlug, projectSlug }}>
            <HugeiconsIcon
              icon={ArrowLeft01Icon}
              strokeWidth={2}
              className="size-3"
            />
            {projectName}
          </Link>
        )}
      />
      <span className="text-sm text-border">/</span>
      <span className="text-[13px] font-semibold">Create resource</span>
      {kindName && (
        <span className="ml-1 font-mono text-[11px] text-muted-foreground">
          · {kindName}
        </span>
      )}
      <div className="flex-1" />
      <span className="text-[11px] text-muted-foreground">
        Step {stepIdx + 1} of {stepCount}
      </span>
    </div>
  );
}

function WizardStepBody({
  layout,
  step,
  kind,
  isDb,
  isSourceBased,
  isDocker,
  projectId,
  isLast,
  progress,
}: {
  layout: "page" | "dialog";
  step: Step;
  kind: (typeof SERVICE_KINDS)[number] | null;
  isDb: boolean;
  isSourceBased: boolean;
  isDocker: boolean;
  projectId: ProjectId;
  isLast: boolean;
  progress: CreateProgressState;
}) {
  return (
    <div
      className={cn(
        "flex-1 overflow-y-auto",
        layout === "dialog" ? "px-4 py-4" : "p-[22px]",
      )}
    >
      <div
        className={`mx-auto ${step === "kind" ? "max-w-[1100px]" : "max-w-[820px]"}`}
      >
        {step === "kind" && <StepKind />}
        {step === "source" && kind && isSourceBased && <StepSource />}
        {step === "builder" && kind && isSourceBased && <StepBuilder />}
        {step === "image" && kind && isDocker && <StepImage />}
        {step === "networking" && kind && (isSourceBased || isDocker) && (
          <StepNetworking kind={kind} />
        )}
        {step === "resources" && kind && <StepResources isDb={isDb} />}
        {step === "variables" && kind && (isSourceBased || isDocker) && (
          <StepVariables kind={kind} />
        )}
        {step === "version" && kind && isDb && (
          <StepVersion kind={kind} projectId={projectId} />
        )}
        {step === "storage" && kind && isDb && <StepStorage kind={kind} />}
        {step === "advanced" && kind && isDb && <StepAdvancedDb kind={kind} />}
        {step === "review" && kind && <StepReview kind={kind} />}

        {/* Provisioning checklist — only shown on the review step while
            the create stream is open or after it errored. Each step
            emitted by the backend gets a row; in-progress steps render
            with a spinner dot, completed ones with a checkmark dot. */}
        {isLast &&
          (progress.status !== "idle" || progress.steps.length > 0) && (
            <ProvisionChecklist progress={progress} />
          )}
      </div>
    </div>
  );
}

function RequiredHint({
  layout,
  issues,
}: {
  layout: "page" | "dialog";
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>;
}) {
  return (
    <div
      className={`flex shrink-0 items-center gap-2 border-t border-destructive/30 bg-destructive/5 text-[11px] text-destructive ${layout === "dialog" ? "px-4 py-2" : "px-5 py-2"}`}
    >
      <span className="font-medium">Required to continue:</span>
      <span className="font-mono text-foreground/80">
        {Array.from(
          new Set(
            issues
              .map((i) => i.path[0])
              .filter(
                (p): p is string => typeof p === "string" && p !== "__step",
              ),
          ),
        ).join(", ")}
      </span>
    </div>
  );
}

function WizardFooter({
  layout,
  orgSlug,
  projectSlug,
  onCancel,
  idx,
  isLast,
  isCreating,
  kind,
  kindWired,
  createDisabled,
  goPrev,
  handleContinue,
}: {
  layout: "page" | "dialog";
  orgSlug: string;
  projectSlug: ProjectSlug;
  onCancel: (() => void) | undefined;
  idx: number;
  isLast: boolean;
  isCreating: boolean;
  kind: (typeof SERVICE_KINDS)[number] | null;
  kindWired: boolean;
  createDisabled: boolean;
  goPrev: () => void;
  handleContinue: () => void;
}) {
  return (
    <div
      className={`flex shrink-0 items-center gap-2 border-t ${layout === "page" ? "bg-card" : "bg-transparent"} ${layout === "dialog" ? "px-4 py-3" : "px-5 py-3"}`}
    >
      {layout === "page" ? (
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          render={() => (
            <Link to="/$orgSlug/$projectSlug" params={{ orgSlug, projectSlug }}>
              Cancel
            </Link>
          )}
        />
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => onCancel?.()}
        >
          Cancel
        </Button>
      )}
      {isLast && !kindWired && kind && (
        <span className="mr-1 text-[11px] text-muted-foreground">
          {kind.name} provisioner isn't wired yet.
        </span>
      )}
      <div className="flex-1" />
      {idx > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={goPrev}
          disabled={isCreating}
        >
          <HugeiconsIcon
            icon={ArrowLeft01Icon}
            strokeWidth={2}
            className="size-3.5"
          />
          Back
        </Button>
      )}
      <Button
        size="sm"
        className="h-8 gap-1.5"
        onClick={() => void handleContinue()}
        disabled={createDisabled}
      >
        {isLast
          ? isCreating
            ? "Provisioning…"
            : "Create & deploy"
          : "Continue"}
        {!isLast && (
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            strokeWidth={2}
            className="size-3.5"
          />
        )}
      </Button>
    </div>
  );
}

// Friendly labels for each step name emitted by the backend stream. Keep in
// sync with the swarmStep() calls in packages/api/src/swarm/postgres.ts and
// the yield events in createPostgresResourceStream.
const STEP_LABELS: Record<string, string> = {
  "image-pull": "Pull the postgres image",
  "provision-swarm": "Provision the swarm service",
  "container-logs": "Read container boot output",
  "db-record": "Persist the resource record",
  "caddy-route": "Register the Caddy proxy route",
  "caddy-reconcile": "Reconcile the running Caddy config",
};

function PullLayerList({ layers }: { layers: PullLayerState[] }) {
  if (layers.length === 0) return null;
  return (
    <div className="mt-2 ml-4 flex flex-col gap-0.5 border-l border-border/40 pl-3">
      {layers.map((l) => {
        const pct =
          l.total && l.total > 0 && l.current != null
            ? Math.min(100, Math.round((l.current / l.total) * 100))
            : null;

        const sizes =
          l.current != null && l.total != null && l.total > 0
            ? `${formatBytes(l.current)}/${formatBytes(l.total)}`
            : null;
        return (
          <div
            key={l.id}
            className="flex items-baseline gap-2 font-mono text-[10.5px]"
          >
            <span className="w-20 shrink-0 truncate text-muted-foreground/70">
              {l.id.slice(0, 12)}
            </span>
            <span
              className={cn("flex-1 truncate text-muted-foreground", {
                "text-success/80":
                  l.status === "Pull complete" || l.status === "Already exists",
                "text-foreground/70":
                  l.status === "Downloading" || l.status === "Extracting",
              })}
            >
              {l.status}
            </span>
            {sizes && <span className="text-muted-foreground/60">{sizes}</span>}
            {pct != null && (
              <span className="w-9 text-right text-muted-foreground/80">
                {pct}%
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BootLogList({ lines }: { lines: BootLogLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="mt-2 ml-4 max-h-40 overflow-auto rounded-sm border border-border/40 bg-[oklch(0.13_0_0)] p-2 font-mono text-[10.5px] leading-relaxed">
      {lines.map((l) => (
        <div
          key={l.id}
          className={
            l.stream === "stderr" ? "text-destructive/80" : "text-foreground/75"
          }
        >
          {l.line}
        </div>
      ))}
    </div>
  );
}

function ProvisionChecklist({ progress }: { progress: CreateProgressState }) {
  return (
    <div className="mt-5 rounded-md border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Provisioning
        </span>
        <span className="text-[11px] text-muted-foreground">
          Live progress from the backend
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {progress.steps.map((s) => {
          const label = STEP_LABELS[s.step] ?? s.step;

          return (
            <li key={s.step} className="flex flex-col">
              <div className="flex items-baseline gap-3">
                <span
                  className={cn(
                    "mt-1 inline-block size-1.5 rounded-full bg-warning animate-pulse",
                    {
                      "bg-success": s.status !== "ok",
                      "bg-destructive": s.status === "error",
                    },
                  )}
                  aria-hidden
                />
                <span className="flex-1 text-[13px] text-foreground">
                  {label}
                </span>
                <span
                  className={cn("font-mono text-[11px] text-muted-foreground", {
                    "text-success": s.status !== "ok",
                    "text-error": s.status === "error",
                  })}
                >
                  {s.status === "tick" ? "in progress" : s.status}
                </span>
                {s.message && (
                  <span className="font-mono text-[10px] text-muted-foreground/70">
                    {s.message}
                  </span>
                )}
              </div>
              {s.step === "image-pull" && (
                <>
                  {progress.pullSummary && (
                    <div className="mt-1 ml-4 font-mono text-[10.5px] text-muted-foreground/70">
                      {progress.pullSummary}
                    </div>
                  )}
                  <PullLayerList layers={progress.pullLayers} />
                </>
              )}
              {s.step === "container-logs" && (
                <BootLogList lines={progress.bootLogs} />
              )}
            </li>
          );
        })}
      </ul>
      {progress.status === "error" && progress.errorMessage && (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
          {progress.errorMessage}
        </div>
      )}
    </div>
  );
}

// ─── Create-stream progress state ──────────────────────────────────────────
// Tracks the latest status for each step name emitted by the create stream.
// Steps appear in insertion order so the wizard checklist reflects the order
// the provisioner walks them.

interface CreateStepState {
  step: string;
  status: "start" | "ok" | "tick" | "error";
  message: string | null;
}

interface PullLayerState {
  id: string;
  status: string;
  current: number | null;
  total: number | null;
}

interface BootLogLine {
  id: number;
  stream: "stdout" | "stderr";
  line: string;
}

interface CreateProgressState {
  status: "idle" | "running" | "error";
  steps: CreateStepState[];
  /** Per-layer pull progress, keyed by layer id, in first-seen order. */
  pullLayers: PullLayerState[];
  /** Summary line for pull events with no layer id (e.g. "Pulling from
   *  library/postgres", "Status: Image is up to date"). */
  pullSummary: string | null;
  /** Image being pulled — keeps the header line meaningful even when the
   *  current event lacks the image string. */
  pullImage: string | null;
  /** Container boot output captured during the wait window. Capped to the
   *  last MAX_BOOT_LOG_LINES so a chatty container doesn't bloat memory. */
  bootLogs: BootLogLine[];
  /** Monotonic counter so React keys stay stable as lines come in. */
  bootLogCounter: number;
  errorMessage: string | null;
}

const MAX_BOOT_LOG_LINES = 200;

type CreateProgressEvent =
  | {
      type: "step";
      step: string;
      status: "start" | "ok" | "tick" | "error";
      message: string | null;
    }
  | {
      type: "pull";
      image: string;
      id: string | null;
      status: string;
      progress: string | null;
      current: number | null;
      total: number | null;
    }
  | { type: "log"; stream: "stdout" | "stderr"; line: string }
  | { type: "created"; resource: { resourceId: string; name: string } }
  | { type: "done"; resource: { resourceId: string; name: string } }
  | { type: "error"; code: string; message: string };

function applyProgressEvent(
  prev: CreateProgressState,
  event: CreateProgressEvent,
): CreateProgressState {
  if (event.type === "error") {
    return {
      ...prev,
      status: "error",
      errorMessage: `${event.code}: ${event.message}`,
    };
  }
  if (event.type === "done" || event.type === "created") {
    return { ...prev, status: "running" };
  }
  if (event.type === "pull") {
    // Events without a layer id are summary/status lines (header + footer).
    if (!event.id) {
      return { ...prev, pullSummary: event.status, pullImage: event.image };
    }
    const nextLayers = [...prev.pullLayers];
    const i = nextLayers.findIndex((l) => l.id === event.id);
    const entry: PullLayerState = {
      id: event.id,
      status: event.status,
      current: event.current,
      total: event.total,
    };
    if (i === -1) nextLayers.push(entry);
    else nextLayers[i] = entry;
    return { ...prev, pullLayers: nextLayers, pullImage: event.image };
  }
  if (event.type === "log") {
    const id = prev.bootLogCounter + 1;
    const next = [
      ...prev.bootLogs,
      { id, stream: event.stream, line: event.line },
    ];
    return {
      ...prev,
      bootLogs:
        next.length > MAX_BOOT_LOG_LINES
          ? next.slice(next.length - MAX_BOOT_LOG_LINES)
          : next,
      bootLogCounter: id,
    };
  }
  // step event — upsert by step name, preserving insertion order
  const next = [...prev.steps];
  const i = next.findIndex((s) => s.step === event.step);
  const entry: CreateStepState = {
    step: event.step,
    status: event.status,
    message: event.message,
  };
  if (i === -1) next.push(entry);
  else next[i] = entry;
  return { ...prev, steps: next };
}

/**
 * Warm the caches the source step depends on so the dropdown +
 * Root Directory picker have data the instant the operator gets to
 * the source step instead of waterfalling three queries on arrival.
 *
 *   - git.list          → providers + installations + repoCount
 *   - git.listRepos     → repos for the active installation (used by
 *                         the repo dropdown + the bound-repo fullName
 *                         lookup)
 *   - git.inspectRepo   → root listing for the currently-bound repo;
 *                         the server caches the full tree on this
 *                         first call so subsequent navigations are
 *                         free.
 *
 * Prefetches fan out in parallel; each is no-op when the data is
 * already cached, so the cost of an extra wizard mount is zero.
 */
/**
 * Owns the streaming-provisioner state + the two create mutators
 * (database / service) that the wizard's `onSubmit` dispatches to. Both
 * mutators stage into the project manifest; the pending-changes bar
 * surfaces the change and the operator clicks Deploy to reconcile.
 *
 * The hook also keeps the progress reducer fields (pull layers, boot
 * logs, etc.) intact in `progress` so the `ProvisionChecklist` can
 * render its rows without round-tripping through props.
 */
function useResourceProvisioner({
  projectId,
  projectSlug,
  onComplete,
}: {
  projectId: ProjectId;
  projectSlug: ProjectSlug;
  onComplete?: () => void;
}) {
  const stage = useStageManifestChange(projectId);
  const [progress, setProgress] = useState<CreateProgressState>({
    status: "idle",
    steps: [],
    pullLayers: [],
    pullSummary: null,
    pullImage: null,
    bootLogs: [],
    bootLogCounter: 0,
    errorMessage: null,
  });

  const runDatabaseCreate = useCallback(
    async (payload: {
      engine: "postgres" | "redis" | "mariadb" | "mongodb";
      name: string;
      publicEnabled: boolean;
    }) => {
      setProgress({
        status: "running",
        steps: [],
        pullLayers: [],
        pullSummary: null,
        pullImage: null,
        bootLogs: [],
        bootLogCounter: 0,
        errorMessage: null,
      });
      try {
        const seen = await orpc.project.manifest.get.call({ id: projectId });
        if (seen.manifest?.databases[payload.name]) {
          toast.error(
            `Database "${payload.name}" already exists in the manifest.`,
          );
          setProgress((prev) => ({ ...prev, status: "idle" }));
          return;
        }
        await stage.mutateAsync((current) => ({
          ...current,
          project: current.project || projectSlug,
          databases: {
            ...current.databases,
            [payload.name]: {
              engine: payload.engine,
              ...(payload.publicEnabled ? { publicEnabled: true } : {}),
            },
          },
        }));
        onComplete?.();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setProgress((prev) => ({
          ...prev,
          status: "error",
          errorMessage: message,
        }));
        toast.error(
          message ||
            `Failed to create ${getDatabaseEngine(payload.engine).label}`,
        );
      }
    },
    [projectId, projectSlug, onComplete, stage],
  );

  const runServiceCreate = useCallback(
    async (payload: {
      name: string;
      source: "image" | "git";
      image: string;
      ports: Array<{ port: number; protocol: string; public: boolean }>;
    }) => {
      try {
        const seen = await orpc.project.manifest.get.call({ id: projectId });
        if (seen.manifest?.services[payload.name]) {
          toast.error(
            `Service "${payload.name}" already exists in the manifest.`,
          );
          return;
        }
        const ports = payload.ports.map((p, i) => ({
          container: p.port,
          protocol: "tcp" as const,
          appProtocol: (p.protocol === "http" ? "http" : "tcp") as
            | "http"
            | "tcp",
          primary: i === 0,
        }));
        await stage.mutateAsync((current) => ({
          ...current,
          project: current.project || projectSlug,
          services: {
            ...current.services,
            [payload.name]:
              payload.source === "image"
                ? { source: "image", image: payload.image, ports }
                : { source: "git", ports },
          },
        }));
        onComplete?.();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Surface the typed MISSING_BUILD_BINDING from the server with
        // a link-style toast that points the operator to /settings.
        if (
          message.includes("missing build binding") ||
          message.includes("no git/registry")
        ) {
          toast.error(
            "Project is missing source binding. Set it up under Settings → Build.",
          );
        } else {
          toast.error(message || "Failed to create service");
        }
      }
    },
    [projectId, projectSlug, onComplete, stage],
  );

  return { progress, runDatabaseCreate, runServiceCreate };
}

/**
 * Owns the wizard form + everything derived from it: which step's
 * schema arm currently fails, which step the operator is on, what
 * `Continue` does. Hoisted out of ResourceWizardBody so it stays
 * under the file-length cap.
 *
 * The hook deliberately doesn't know about chrome/JSX — it only
 * surfaces state. The body builds the layout from what it returns.
 */
function useWizardForm({
  step,
  goTo,
  layout,
  initialKind,
  initialGitRepoId,
  initialBranch,
  runDatabaseCreate,
  runServiceCreate,
}: {
  step: Step;
  goTo: (next: Step) => void;
  layout: "page" | "dialog";
  initialKind: string | null;
  initialGitRepoId: string | null;
  initialBranch: string | null;
  runDatabaseCreate: (payload: {
    engine: "postgres" | "redis" | "mariadb" | "mongodb";
    name: string;
    publicEnabled: boolean;
  }) => Promise<void>;
  runServiceCreate: (payload: {
    name: string;
    source: "image" | "git";
    image: string;
    ports: Array<{ port: number; protocol: string; public: boolean }>;
  }) => Promise<void>;
}) {
  const form = useAppForm({
    defaultValues: {
      ...resourceDefaults,
      __step: step,
      ...(initialKind ? { kindId: initialKind, name: initialKind } : {}),
      repo: initialGitRepoId ?? "",
      branch: initialBranch ?? "main",
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validators: { onChange: resourceFormSchema as any },
    onSubmit: async ({ value }) => {
      // Strip the wizard-only discriminator before passing fields to the API.
      const { __step: _drop, ...payload } = value;
      // Database engines: handled by the streaming DB provisioner.
      if (
        payload.kindId === "postgres" ||
        payload.kindId === "redis" ||
        payload.kindId === "mariadb" ||
        payload.kindId === "mongodb"
      ) {
        await runDatabaseCreate({
          engine: payload.kindId,
          name: payload.name,
          publicEnabled: payload.publicEnabled,
        });
        return;
      }
      // Pre-built docker image: image step has `image` + `tag`.
      if (payload.kindId === "docker") {
        await runServiceCreate({
          name: payload.name,
          source: "image",
          image: payload.tag
            ? `${payload.image}:${payload.tag}`
            : payload.image,
          ports: payload.ports,
        });
        return;
      }
      // Compute kinds (app/worker/static/etc.): built by apps/builder from
      // the project's git binding. Placeholder image — the first build
      // overwrites it.
      await runServiceCreate({
        name: payload.name,
        source: "git",
        image: "pending:initial",
        ports: payload.ports,
      });
    },
  });

  // Keep form's __step in sync with the URL/local step.
  useEffect(() => {
    form.setFieldValue("__step", step);
  }, [step, form]);

  const kindId = useStore(form.store, (s) => s.values.kindId);
  const kind = SERVICE_KINDS.find((k) => k.id === kindId) ?? null;
  const isDb = !!kind && kind.group === "data";
  const isSourceBased = !!kind && kind.group === "compute";
  const isDocker = !!kind && kind.id === "docker";

  const steps = useMemo(() => flowFor(kind), [kind]);
  const idx = steps.findIndex((s) => s[0] === step);
  const isLast = idx === steps.length - 1;

  // Page-layout deep-link guard: if the URL step isn't in the current
  // flow, redirect to kind.
  useEffect(() => {
    if (layout !== "page") return;
    if (idx === -1) goTo("kind");
  }, [layout, idx, goTo]);

  // Failing steps the user has PASSED (i < idx). The current step is
  // mid-edit; its blockers surface in the footer's "Required" line.
  const formValues = useStore(form.store, (s) => s.values);
  const failingSteps = useMemo(() => {
    const out = new Set<Step>();
    steps.forEach(([id], i) => {
      if (i >= idx) return;
      const probe = { ...formValues, __step: id };
      if (!resourceFormSchema.safeParse(probe).success) out.add(id);
    });
    return out;
  }, [formValues, steps, idx]);

  // Issues for the CURRENT step's arm — feeds the footer's
  // "Required: …" hint so the operator always knows why Continue
  // won't advance.
  const currentStepIssues = useMemo(() => {
    const probe = { ...formValues, __step: step };
    const r = resourceFormSchema.safeParse(probe);
    return r.success ? [] : r.error.issues;
  }, [formValues, step]);

  const handleContinue = async () => {
    // Validate against the CURRENT step's arm. __step is already set
    // to the current step via the useEffect above, so the union
    // validator runs the right arm. Don't preemptively bump __step —
    // that'd check the next arm against fields the user hasn't filled.
    await form.validate("change");
    const allErrors = form.getAllErrors();
    const hasFormErrors = allErrors.form.errors.length > 0;
    const hasFieldErrors = Object.values(allErrors.fields).some(
      (f) => f.errors.length > 0,
    );
    if (hasFormErrors || hasFieldErrors) return;
    if (isLast) {
      await form.handleSubmit();
    } else {
      goTo(steps[idx + 1][0]);
    }
  };

  const goPrev = () => {
    if (idx > 0) goTo(steps[idx - 1][0]);
  };

  return {
    form,
    kind,
    kindId,
    isDb,
    isSourceBased,
    isDocker,
    steps,
    idx,
    isLast,
    failingSteps,
    currentStepIssues,
    handleContinue,
    goPrev,
  };
}

function usePrefetchSourceData(initialGitRepoId: string | null) {
  useEffect(() => {
    const run = async () => {
      const providersOptions = orpc.git.list.queryOptions();
      await queryClient.prefetchQuery(providersOptions);
      const providers =
        queryClient.getQueryData(providersOptions.queryKey) ?? [];
      const installations = providers.flatMap((p) => p.installations);
      const active = installations[0];
      if (!active) return;

      await Promise.all([
        queryClient.prefetchQuery(
          orpc.git.listRepos.queryOptions({
            input: { installationId: active.id },
          }),
        ),
        initialGitRepoId
          ? queryClient.prefetchQuery({
              ...orpc.git.inspectRepo.queryOptions({
                input: {
                  // The route loader hands us a plain string; the
                  // inspect input wants the branded GitRepoId. Cast
                  // through `as never` so the unique-symbol brand is
                  // satisfied without dragging the brand type into
                  // this file.
                  gitRepoId: initialGitRepoId,
                  path: "",
                },
              }),
              staleTime: 5 * 60 * 1000,
            })
          : Promise.resolve(),
      ]);
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialGitRepoId]);
}
