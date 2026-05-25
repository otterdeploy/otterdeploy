import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { ID_PREFIX, type Slug } from "@otterstack/shared/id";
import { useStore } from "@tanstack/react-form";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { SERVICE_KINDS } from "@/features/projects/data/service-kinds";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

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
  projectName,
  initialKind = null,
  onComplete,
  onCancel,
  layout,
  step,
  goTo,
}: BodyProps) {
  const form = useAppForm({
    defaultValues: initialKind
      ? { ...resourceDefaults, __step: step, kindId: initialKind, name: initialKind }
      : { ...resourceDefaults, __step: step },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validators: { onChange: resourceFormSchema as any },
    onSubmit: async ({ value }) => {
      // Strip the discriminator before persisting.
      const { __step: _drop, ...payload } = value;
      console.log("submit", payload);
      if (onComplete) onComplete();
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
  const formValues = useStore(form.store, (s) => s.values);
  const failingSteps = useMemo(() => {
    const out = new Set<Step>();
    for (const [id] of steps) {
      const probe = { ...formValues, __step: id };
      if (!resourceFormSchema.safeParse(probe).success) out.add(id);
    }
    return out;
  }, [formValues, steps]);

  const handleContinue = async () => {
    const nextStep: Step = isLast ? "review" : steps[idx + 1][0];
    // Set __step to next step so the onChange validator validates against that arm
    form.setFieldValue("__step", nextStep);
    await form.validate("change");
    // Check form-level and field-level validity after validation run
    const allErrors = form.getAllErrors();
    const hasFormErrors = allErrors.form.errors.length > 0;
    const hasFieldErrors = Object.values(allErrors.fields).some(
      (f) => f.errors.length > 0,
    );
    if (hasFormErrors || hasFieldErrors) {
      // Revert __step back to current so the user stays on the current step
      form.setFieldValue("__step", step);
      return;
    }
    if (isLast) {
      await form.handleSubmit();
    } else {
      goTo(nextStep);
    }
  };

  const goPrev = () => {
    if (idx > 0) goTo(steps[idx - 1][0]);
  };
  const showChrome = layout === "page";

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
            {step === "version" && kind && isDb && <StepVersion kind={kind} />}
            {step === "storage" && kind && isDb && <StepStorage kind={kind} />}
            {step === "advanced" && kind && isDb && <StepAdvancedDb kind={kind} />}
            {step === "review" && kind && <StepReview kind={kind} />}
          </div>
        </div>

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
          <div className="flex-1" />
          {idx > 0 && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={goPrev}>
              <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-3.5" />
              Back
            </Button>
          )}
          <Button size="sm" className="h-8 gap-1.5" onClick={() => void handleContinue()}>
            {isLast ? "Create & deploy" : "Continue"}
            {!isLast && <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5" />}
          </Button>
        </div>
      </div>
    </form.AppForm>
  );
}
