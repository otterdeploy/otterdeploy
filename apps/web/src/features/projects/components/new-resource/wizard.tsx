import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ProjectId, ProjectSlug } from "@otterdeploy/shared/id";
import { useStore } from "@tanstack/react-form";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { getDatabaseEngine } from "@otterdeploy/shared/database-engines";

import {
  SERVICE_KINDS,
  type ServiceKind,
} from "@/features/projects/data/service-kinds";
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
  step: Step;
  goTo: (next: Step) => void;
}

// Single dialog-layout entry point — the standalone /new-resource page
// route was dropped. Step lives in local state.
export function ResourceWizard(props: ResourceWizardProps) {
  const [step, setStep] = useState<Step>(props.initialStep ?? "kind");
  return <ResourceWizardBody {...props} step={step} goTo={setStep} />;
}

function ResourceWizardBody({
  projectSlug,
  projectId,
  initialKind = null,
  initialGitRepoId = null,
  initialBranch = null,
  onComplete,
  onCancel,
  step,
  goTo,
}: BodyProps) {
  usePrefetchSourceData(initialGitRepoId ?? null);

  // Provisioner state + create mutators (database + service) hoisted
  // into a hook so this component stays under the file-length cap.
  const { isCreating, runDatabaseCreate, runServiceCreate } =
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
    initialKind,
    initialGitRepoId,
    initialBranch,
    runDatabaseCreate,
    runServiceCreate,
  });

  const kindWired = isKindWired(kindId, kind);
  const createDisabled = isLast && (!kindWired || isCreating);

  return (
    <form.AppForm>
      <div className="flex h-full flex-col bg-transparent text-foreground">
        <Stepper
          steps={steps}
          idx={idx}
          setStep={goTo}
          failingSteps={failingSteps}
        />

        <WizardStepBody
          step={step}
          kind={kind}
          isDb={isDb}
          isSourceBased={isSourceBased}
          isDocker={isDocker}
          projectId={projectId}
        />

        {currentStepIssues.length > 0 && (
          <RequiredHint issues={currentStepIssues} />
        )}

        <WizardFooter
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
function isKindWired(kindId: string, kind: ServiceKind | null): boolean {
  if (kindId === "docker") return true;
  if (WIRED_DB_KINDS.has(kindId)) return true;
  return kind?.group === "compute";
}

// ─── Render helpers ─────────────────────────────────────────────────────
// Pulled out of ResourceWizardBody so it stays under the file-length
// cap. Each helper is a pure presentational component over the wizard
// state the body already computed; no hooks live in this band.

// Per-step dispatch table — collapses the 11-way `step === "X" && cond
// && <StepX />` JSX chain (cyclomatic-36) into a Record lookup. Each
// entry decides whether it should render for the current context and
// returns the React node or `null`. WizardStepBody is now one lookup.
interface StepCtx {
  kind: ServiceKind | null;
  isDb: boolean;
  isSourceBased: boolean;
  isDocker: boolean;
  projectId: ProjectId;
}
const STEP_RENDERERS: Record<Step, (ctx: StepCtx) => React.ReactNode | null> = {
  kind: () => <StepKind />,
  source: ({ kind, isSourceBased }) =>
    kind && isSourceBased ? <StepSource /> : null,
  builder: ({ kind, isSourceBased }) =>
    kind && isSourceBased ? <StepBuilder /> : null,
  image: ({ kind, isDocker }) => (kind && isDocker ? <StepImage /> : null),
  networking: ({ kind, isSourceBased, isDocker }) =>
    kind && (isSourceBased || isDocker) ? <StepNetworking kind={kind} /> : null,
  resources: ({ kind, isDb }) => (kind ? <StepResources isDb={isDb} /> : null),
  variables: ({ kind, isSourceBased, isDocker }) =>
    kind && (isSourceBased || isDocker) ? <StepVariables kind={kind} /> : null,
  version: ({ kind, isDb, projectId }) =>
    kind && isDb ? <StepVersion kind={kind} projectId={projectId} /> : null,
  storage: ({ kind, isDb }) =>
    kind && isDb ? <StepStorage kind={kind} /> : null,
  advanced: ({ kind, isDb }) =>
    kind && isDb ? <StepAdvancedDb kind={kind} /> : null,
  review: ({ kind }) => (kind ? <StepReview kind={kind} /> : null),
};

function WizardStepBody({
  step,
  kind,
  isDb,
  isSourceBased,
  isDocker,
  projectId,
}: {
  step: Step;
  kind: ServiceKind | null;
  isDb: boolean;
  isSourceBased: boolean;
  isDocker: boolean;
  projectId: ProjectId;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div
        className={cn("mx-auto max-w-205", { "max-w-275": step === "kind" })}
      >
        {STEP_RENDERERS[step]({
          kind,
          isDb,
          isSourceBased,
          isDocker,
          projectId,
        })}
      </div>
    </div>
  );
}

function RequiredHint({
  issues,
}: {
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-destructive/30 bg-destructive/5 px-4 py-2 text-[11px] text-destructive">
      <span className="font-medium">Required to continue:</span>
      <span className="font-mono text-foreground/80">
        {Array.from(
          new Set(
            issues
              .map((i) => i.path[0])
              .filter((p) => typeof p === "string" && p !== "__step"),
          ),
        ).join(", ")}
      </span>
    </div>
  );
}

function WizardFooter({
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
  onCancel: (() => void) | undefined;
  idx: number;
  isLast: boolean;
  isCreating: boolean;
  kind: ServiceKind | null;
  kindWired: boolean;
  createDisabled: boolean;
  goPrev: () => void;
  handleContinue: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-t bg-transparent px-4 py-3">
      <Button
        variant="outline"
        size="sm"
        className="h-8"
        onClick={() => onCancel?.()}
      >
        Cancel
      </Button>
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
 * Owns the two create mutators (database / service) that the wizard's
 * `onSubmit` dispatches to. Both mutators stage into the project
 * manifest; the pending-changes bar surfaces the change and the
 * operator clicks Deploy to reconcile. `isCreating` mirrors the
 * underlying mutation's pending state so the footer can disable the
 * submit button while the save is in flight.
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

  const runDatabaseCreate = useCallback(
    async (payload: {
      engine: "postgres" | "redis" | "mariadb" | "mongodb";
      name: string;
      publicEnabled: boolean;
    }) => {
      try {
        const seen = await orpc.project.manifest.get.call({ id: projectId });
        if (seen.manifest?.databases[payload.name]) {
          toast.error(
            `Database "${payload.name}" already exists in the manifest.`,
          );
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
          appProtocol:
            p.protocol === "http" ? ("http" as const) : ("tcp" as const),
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

  return { isCreating: stage.isPending, runDatabaseCreate, runServiceCreate };
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
  initialKind,
  initialGitRepoId,
  initialBranch,
  runDatabaseCreate,
  runServiceCreate,
}: {
  step: Step;
  goTo: (next: Step) => void;
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
