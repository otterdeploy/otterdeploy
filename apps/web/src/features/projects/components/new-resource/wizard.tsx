import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { ID_PREFIX, type Id, type Slug } from "@otterstack/shared/id";
import { useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { SERVICE_KINDS } from "@/features/projects/data/service-kinds";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

import { useAppForm } from "./form-context";
import { flowFor, type StepEntry } from "./flows";
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
  projectSlug: Slug<typeof ID_PREFIX.project>;
  projectId: Id<typeof ID_PREFIX.project>;
  projectName: string;
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
  const search = useSearch({ from: "/_app/$orgSlug/$projectSlug/new-resource" });
  const navigate = useNavigate();
  const step = ((search as Record<string, unknown>).step ?? "kind") as Step;
  const goTo = (next: Step) =>
    void navigate({
      to: "/$orgSlug/$projectSlug/new-resource",
      params: { orgSlug: props.orgSlug, projectSlug: props.projectSlug },
      search: (s) => ({ ...s, step: next }),
    });
  return <ResourceWizardBody {...props} layout="page" step={step} goTo={goTo} />;
}

// Dialog-layout entry point: step lives in local state.
export function DialogResourceWizard(props: ResourceWizardProps) {
  const [step, setStep] = useState<Step>(props.initialStep ?? "kind");
  return <ResourceWizardBody {...props} layout="dialog" step={step} goTo={setStep} />;
}

function ResourceWizardBody({
  orgSlug,
  projectSlug,
  projectId,
  projectName,
  initialKind = null,
  onComplete,
  onCancel,
  layout,
  step,
  goTo,
}: BodyProps) {
  const navigate = useNavigate();

  // Postgres is the first engine wired end-to-end. The mutation hits
  // project.resource.database.postgres.create which handles Swarm provision,
  // Caddy proxy-route insert, and DB record. Other kinds fall through with a
  // "not yet supported" gate on the Create button below.
  const postgresCreate = useMutation(
    orpc.project.resource.database.postgres.create.mutationOptions({
      onSuccess: async (created) => {
        await queryClient.invalidateQueries({
          queryKey: orpc.project.resource.list.queryKey({ input: { projectId } }),
        });
        toast.success(`Postgres ${created.name} is provisioning`);
        onComplete?.();
        void navigate({
          to: "/$orgSlug/$projectSlug/graph/$resourceId",
          params: {
            orgSlug,
            projectSlug,
            resourceId: created.resourceId,
          },
        });
      },
      onError: (err) => {
        toast.error(err.message ?? "Failed to create Postgres");
      },
    }),
  );

  const form = useAppForm({
    defaultValues: initialKind
      ? { ...resourceDefaults, __step: step, kindId: initialKind, name: initialKind }
      : { ...resourceDefaults, __step: step },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validators: { onChange: resourceFormSchema as any },
    onSubmit: async ({ value }) => {
      // Strip the wizard-only discriminator before passing fields to the API.
      const { __step: _drop, ...payload } = value;
      if (payload.kindId === "postgres") {
        await postgresCreate.mutateAsync({
          projectId,
          name: payload.name,
          publicEnabled: payload.publicEnabled,
        });
        return;
      }
      // Other engines aren't wired yet — the Create button is gated below so
      // this branch shouldn't be reachable through the UI.
      console.warn("[new-resource] submit ignored: kind not wired", payload.kindId);
    },
  });

  // Keep form's __step in sync with the URL/local step
  useEffect(() => {
    form.setFieldValue("__step", step);
  }, [step, form]);

  const kindId = useStore(form.store, (s) => s.values.kindId as string);
  const kind = SERVICE_KINDS.find((k) => k.id === kindId) ?? null;
  const isDb = !!kind && kind.group === "data";
  const isSourceBased = !!kind && kind.group === "compute";
  const isDocker = !!kind && kind.id === "docker";

  const steps: StepEntry[] = useMemo(() => flowFor(kind), [kind]);
  const idx = steps.findIndex((s) => s[0] === step);
  const isLast = idx === steps.length - 1;

  // Page-layout deep-link guard: if the URL step isn't in the current flow, redirect to kind.
  useEffect(() => {
    if (layout !== "page") return;
    if (idx === -1) goTo("kind");
  }, [layout, idx, goTo]);

  // Compute failing-step set so Stepper marks them red.
  // Only mark steps the user has PASSED (i < idx). The current step is
  // mid-edit and shouldn't render as an error — its blockers surface in the
  // footer's "Required" line instead.
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

  // Issues for the CURRENT step's arm, used to render the footer's
  // "Required: …" hint so the user always knows why Continue won't advance.
  const currentStepIssues = useMemo(() => {
    const probe = { ...formValues, __step: step };
    const r = resourceFormSchema.safeParse(probe);
    return r.success ? [] : r.error.issues;
  }, [formValues, step]);

  const handleContinue = async () => {
    // Validate against the CURRENT step's arm. __step is already set to the
    // current step (via the useEffect sync above), so the union validator runs
    // the right arm. Don't preemptively set __step to next — that would check
    // the next arm against fields the user hasn't entered yet.
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
  const showChrome = layout === "page";

  // Only Postgres is wired through to a real provisioner today. Keep the
  // wizard browsable for every kind but gate the final Create action so we
  // don't pretend to deploy something that isn't implemented yet.
  const kindWired = kindId === "postgres";
  const isCreating = postgresCreate.isPending;
  const createDisabled = isLast && (!kindWired || isCreating);

  return (
    <form.AppForm>
      <div className={`flex h-full flex-col text-foreground ${layout === "page" ? "bg-background" : "bg-transparent"}`}>
        {showChrome && (
          <div className="flex shrink-0 items-center gap-3 border-b bg-card px-5 py-3">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
              render={() => (
                <Link to="/$orgSlug/$projectSlug" params={{ orgSlug, projectSlug }}>
                  <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-3" />
                  {projectName}
                </Link>
              )}
            />
            <span className="text-sm text-border">/</span>
            <span className="text-[13px] font-semibold">Create resource</span>
            {kind && <span className="ml-1 font-mono text-[11px] text-muted-foreground">· {kind.name}</span>}
            <div className="flex-1" />
            <span className="text-[11px] text-muted-foreground">Step {idx + 1} of {steps.length}</span>
          </div>
        )}

        <Stepper steps={steps} idx={idx} setStep={goTo} failingSteps={failingSteps} />

        <div className={cn("flex-1 overflow-y-auto", layout === "dialog" ? "px-[18px] py-4" : "p-[22px]")}>
          <div className={`mx-auto ${step === "kind" ? "max-w-[1100px]" : "max-w-[820px]"}`}>
            {step === "kind" && <StepKind />}
            {step === "source" && kind && isSourceBased && <StepSource />}
            {step === "builder" && kind && isSourceBased && <StepBuilder />}
            {step === "image" && kind && isDocker && <StepImage />}
            {step === "networking" && kind && (isSourceBased || isDocker) && <StepNetworking kind={kind} />}
            {step === "resources" && kind && <StepResources isDb={isDb} />}
            {step === "variables" && kind && (isSourceBased || isDocker) && <StepVariables kind={kind} />}
            {step === "version" && kind && isDb && (
              <StepVersion kind={kind} projectId={projectId} />
            )}
            {step === "storage" && kind && isDb && <StepStorage kind={kind} />}
            {step === "advanced" && kind && isDb && <StepAdvancedDb kind={kind} />}
            {step === "review" && kind && <StepReview kind={kind} />}
          </div>
        </div>

        {currentStepIssues.length > 0 && (
          <div className={`flex shrink-0 items-center gap-2 border-t border-destructive/30 bg-destructive/5 text-[11px] text-destructive ${layout === "dialog" ? "px-[18px] py-2" : "px-5 py-2"}`}>
            <span className="font-medium">Required to continue:</span>
            <span className="font-mono text-foreground/80">
              {Array.from(
                new Set(
                  currentStepIssues
                    .map((i) => i.path[0])
                    .filter((p): p is string => typeof p === "string" && p !== "__step"),
                ),
              ).join(", ")}
            </span>
          </div>
        )}

        <div className={`flex shrink-0 items-center gap-2 border-t ${layout === "page" ? "bg-card" : "bg-transparent"} ${layout === "dialog" ? "px-[18px] py-3" : "px-5 py-3"}`}>
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
            <Button variant="outline" size="sm" className="h-8" onClick={() => onCancel?.()}>
              Cancel
            </Button>
          )}
          {isLast && !kindWired && kind && (
            <span className="mr-1 text-[11px] text-muted-foreground">
              {kind.name} provisioner isn’t wired yet — only Postgres is live today.
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
              <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-3.5" />
              Back
            </Button>
          )}
          <Button
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => void handleContinue()}
            disabled={createDisabled}
          >
            {isLast ? (isCreating ? "Provisioning…" : "Create & deploy") : "Continue"}
            {!isLast && <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5" />}
          </Button>
        </div>
      </div>
    </form.AppForm>
  );
}
