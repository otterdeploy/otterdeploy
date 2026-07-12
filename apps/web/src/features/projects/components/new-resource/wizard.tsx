import type { ProjectId, ProjectSlug } from "@otterdeploy/shared/id";

import { useCallback, useState } from "react";

import type { ComposePrefill } from "./compose-wizard-shared";
import type { Step } from "./schemas";

import { ComposeWizard } from "./compose-wizard";
import { Stepper } from "./steps";
import { useDetectionDefaults } from "./use-repo-detection";
import { isKindWired, RequiredHint, WizardFooter, WizardStepBody } from "./wizard-chrome";
import { useWizardForm } from "./wizard-form";
import { useResourceProvisioner, usePrefetchSourceData } from "./wizard-provisioner";

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
  /** Template handoff: pair with `initialKind: "compose"` to open the compose
   *  flow seeded with a template's name + YAML (see features/templates/). */
  composePrefill?: ComposePrefill;
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
  orgSlug,
  projectSlug,
  projectId,
  initialKind = null,
  initialGitRepoId = null,
  initialBranch = null,
  composePrefill,
  onComplete,
  onCancel,
  step,
  goTo,
}: BodyProps) {
  usePrefetchSourceData(initialGitRepoId ?? null);

  // Provisioner state + create mutators (database + service) hoisted
  // into a hook so this component stays under the file-length cap.
  const { isCreating, runDatabaseCreate, runServiceCreate } = useResourceProvisioner({
    projectId,
    orgSlug,
    projectSlug,
    onComplete,
  });

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
    advancedSetup,
    setAdvanced,
  } = useWizardForm({
    step,
    goTo,
    initialKind,
    initialGitRepoId,
    initialBranch,
    runDatabaseCreate,
    runServiceCreate,
  });

  // Detection-driven defaults: once the repo is bound, inspection answers the
  // SPA toggle and the port question so the user doesn't have to.
  useDetectionDefaults(form);

  const kindWired = isKindWired(kindId, kind);
  const createDisabled = isLast && (!kindWired || isCreating);

  // Database engine sub-view of the first (Source) step. Owned here so its
  // "Back" can live in the footer next to Continue instead of inline.
  const [dbEngineView, setDbEngineView] = useState(false);
  const exitDbEngineView = useCallback(() => {
    setDbEngineView(false);
    form.setFieldValue("kindId", "");
    form.setFieldValue("version", null);
  }, [form]);
  const showDbBack = step === "kind" && dbEngineView;

  // Compose is its own resource type, not a manifest-staged service — once it's
  // picked, hand off to the dedicated compose flow.
  if (kindId === "compose") {
    return (
      <ComposeWizard
        orgSlug={orgSlug}
        projectId={projectId}
        projectSlug={projectSlug}
        prefill={composePrefill}
        onComplete={onComplete}
        onCancel={onCancel}
      />
    );
  }

  return (
    <form.AppForm>
      <div className="flex h-full flex-col bg-transparent text-foreground">
        <Stepper steps={steps} idx={idx} setStep={goTo} failingSteps={failingSteps} />

        <WizardStepBody
          step={step}
          kind={kind}
          isDb={isDb}
          isSourceBased={isSourceBased}
          isDocker={isDocker}
          projectId={projectId}
          dbView={dbEngineView}
          onDbViewChange={setDbEngineView}
        />

        {currentStepIssues.length > 0 && <RequiredHint issues={currentStepIssues} />}

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
          showAdvancedToggle={idx === 0 && !!kind && !showDbBack}
          advancedSetup={advancedSetup}
          onAdvancedChange={setAdvanced}
          showDbBack={showDbBack}
          onDbBack={exitDbEngineView}
        />
      </div>
    </form.AppForm>
  );
}
