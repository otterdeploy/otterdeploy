// Wizard component — extracted from routes/_app/$orgSlug/$projectSlug/new-resource.tsx
// so the same wizard can render inside a Dialog (variant B) and the route page.
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { ID_PREFIX, type Slug } from "@otterstack/shared/id";
import { useForm, useStore } from "@tanstack/react-form";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  resourceSchema,
  resourceDefaults,
} from "@/features/projects/components/new-resource/schema";
import { StepAdvancedDb } from "@/features/projects/components/new-resource/step-advanced-db";
import { StepBuilder } from "@/features/projects/components/new-resource/step-builder";
import { StepImage } from "@/features/projects/components/new-resource/step-image";
import { StepKind } from "@/features/projects/components/new-resource/step-kind";
import { StepNetworking } from "@/features/projects/components/new-resource/step-networking";
import { StepResources } from "@/features/projects/components/new-resource/step-resources";
import { StepReview } from "@/features/projects/components/new-resource/step-review";
import { StepSource } from "@/features/projects/components/new-resource/step-source";
import { StepStorage } from "@/features/projects/components/new-resource/step-storage";
import { StepVariables } from "@/features/projects/components/new-resource/step-variables";
import { StepVersion } from "@/features/projects/components/new-resource/step-version";
import { Stepper, type Step } from "@/features/projects/components/new-resource/stepper";
import { SERVICE_KINDS } from "@/features/projects/data/service-kinds";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

const DB_STEPS: Array<[Step, string, string]> = [
  ["kind", "Kind", "pick-kind"],
  ["version", "Version", "pick-version"],
  ["resources", "Resources", "pick-resources"],
  ["storage", "Storage & backups", "storage"],
  ["advanced", "Advanced", "advanced"],
  ["review", "Review", "review"],
];

// Build-from-source flow: app / worker / static / cron / function.
const SOURCE_STEPS: Array<[Step, string, string]> = [
  ["kind", "Kind", "pick-kind"],
  ["source", "Source", "source"],
  ["builder", "Builder", "builder"],
  ["networking", "Networking", "networking"],
  ["resources", "Resources", "pick-resources"],
  ["variables", "Variables", "variables"],
  ["review", "Review", "review"],
];

// Custom OCI image flow.
const DOCKER_STEPS: Array<[Step, string, string]> = [
  ["kind", "Kind", "pick-kind"],
  ["image", "Image", "pick-image"],
  ["networking", "Networking", "networking"],
  ["resources", "Resources", "pick-resources"],
  ["variables", "Variables", "variables"],
  ["review", "Review", "review"],
];

const KIND_STEPS: Array<[Step, string, string]> = [["kind", "Kind", "pick-kind"]];

export interface ResourceWizardProps {
  orgSlug: string;
  projectSlug: Slug<typeof ID_PREFIX.project>;
  projectName: string;
  initialKind?: string | null;
  initialStep?: Step;
  onComplete?: () => void;
  onCancel?: () => void;
  layout?: "page" | "dialog";
}

export function ResourceWizard({
  orgSlug,
  projectSlug,
  projectName,
  initialKind = null,
  initialStep,
  onComplete,
  onCancel,
  layout = "page",
}: ResourceWizardProps) {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>(initialStep ?? "kind");

  const form = useForm({
    defaultValues: initialKind
      ? { ...resourceDefaults, kindId: initialKind, name: initialKind }
      : resourceDefaults,
    validators: { onChange: resourceSchema },
    onSubmit: async ({ value }) => {
      console.log("submit", value);
      if (onComplete) {
        onComplete();
      } else {
        void navigate({
          to: "/$orgSlug/$projectSlug",
          params: { orgSlug, projectSlug },
        });
      }
    },
  });

  const kindId = useStore(form.store, (s) => s.values.kindId);
  const version = useStore(form.store, (s) => s.values.version);

  const kind = SERVICE_KINDS.find((k) => k.id === kindId) ?? null;
  const isDb = !!kind && kind.group === "data";
  const isSourceBased = !!kind && kind.group === "compute";
  const isDocker = !!kind && kind.id === "docker";

  const steps = useMemo(() => {
    if (!kind) return KIND_STEPS;
    if (isDb) return DB_STEPS;
    if (isSourceBased) return SOURCE_STEPS;
    if (isDocker) return DOCKER_STEPS;
    return KIND_STEPS;
  }, [kind, isDb, isSourceBased, isDocker]);

  const idx = steps.findIndex((s) => s[0] === step);
  const isLast = idx === steps.length - 1;

  const goNext = () => {
    if (idx < steps.length - 1) setStep(steps[idx + 1][0]);
  };
  const goPrev = () => {
    if (idx > 0) setStep(steps[idx - 1][0]);
  };

  const canAdvance = (() => {
    if (step === "kind") return !!kindId;
    if (step === "version") return !!version && version.length > 0;
    return true;
  })();

  const handleContinue = () => {
    if (isLast) {
      void form.handleSubmit();
    } else {
      goNext();
    }
  };

  const showChrome = layout === "page";

  return (
    <div
      className={`flex h-full flex-col text-foreground ${
        layout === "page" ? "bg-background" : "bg-transparent"
      }`}
    >
      {showChrome && (
        <div className="flex shrink-0 items-center gap-3 border-b bg-card px-5 py-3">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
          >
            <Link to="/$orgSlug/$projectSlug" params={{ orgSlug, projectSlug }}>
              <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-3" />
              {projectName}
            </Link>
          </Button>
          <span className="text-sm text-border">/</span>
          <span className="text-[13px] font-semibold">Create resource</span>
          {kind && (
            <span className="ml-1 font-mono text-[11px] text-muted-foreground">
              · {kind.name}
            </span>
          )}
          <div className="flex-1" />
          <span className="text-[11px] text-muted-foreground">
            Step {idx + 1} of {steps.length}
          </span>
        </div>
      )}

      <Stepper steps={steps} idx={idx} setStep={setStep} />

      <div
        className={cn(
          "flex-1 overflow-y-auto",
          layout === "dialog" ? "px-[18px] py-4" : "p-[22px]",
        )}
      >
        <div
          className={`mx-auto ${step === "kind" ? "max-w-[1100px]" : "max-w-[820px]"}`}
        >
          {step === "kind" && (
            <StepKind
              kindId={kindId}
              setKindId={(id) => {
                form.setFieldValue("kindId", id);
                const k = SERVICE_KINDS.find((x) => x.id === id);
                if (k) {
                  form.setFieldValue("name", k.id);
                  if (k.versions && k.versions.length > 0) {
                    form.setFieldValue("version", k.versions[0]);
                  } else {
                    form.setFieldValue("version", null);
                  }
                }
              }}
            />
          )}

          {step !== "kind" && !isDb && !isSourceBased && !isDocker && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Coming soon for {kind?.group ?? "this"} resources
            </div>
          )}

          {step === "source" && kind && isSourceBased && (
            <form.Field name="src">
              {(srcField) => (
                <form.Field name="repo">
                  {(repoField) => (
                    <form.Field name="branch">
                      {(branchField) => (
                        <form.Field name="root">
                          {(rootField) => (
                            <form.Field name="autoDeploy">
                              {(autoDeployField) => (
                                <form.Field name="previewBranches">
                                  {(previewBranchesField) => (
                                    <form.Field name="name">
                                      {(nameField) => (
                                        <StepSource
                                          srcField={srcField}
                                          repoField={repoField}
                                          branchField={branchField}
                                          rootField={rootField}
                                          autoDeployField={autoDeployField}
                                          previewBranchesField={previewBranchesField}
                                          nameField={nameField}
                                        />
                                      )}
                                    </form.Field>
                                  )}
                                </form.Field>
                              )}
                            </form.Field>
                          )}
                        </form.Field>
                      )}
                    </form.Field>
                  )}
                </form.Field>
              )}
            </form.Field>
          )}

          {step === "builder" && kind && isSourceBased && (
            <form.Field name="builderId">
              {(builderIdField) => (
                <form.Field name="name">
                  {(nameField) => (
                    <StepBuilder builderIdField={builderIdField} nameField={nameField} />
                  )}
                </form.Field>
              )}
            </form.Field>
          )}

          {step === "image" && kind && isDocker && (
            <form.Field name="registry">
              {(registryField) => (
                <form.Field name="image">
                  {(imageField) => (
                    <form.Field name="tag">
                      {(tagField) => (
                        <form.Field name="name">
                          {(nameField) => (
                            <StepImage
                              registryField={registryField}
                              imageField={imageField}
                              tagField={tagField}
                              nameField={nameField}
                            />
                          )}
                        </form.Field>
                      )}
                    </form.Field>
                  )}
                </form.Field>
              )}
            </form.Field>
          )}

          {step === "networking" && kind && (isSourceBased || isDocker) && (
            <form.Field name="ports">
              {(portsField) => (
                <form.Field name="healthPath">
                  {(healthPathField) => (
                    <form.Field name="healthInterval">
                      {(healthIntervalField) => (
                        <StepNetworking
                          portsField={portsField}
                          healthPathField={healthPathField}
                          healthIntervalField={healthIntervalField}
                        />
                      )}
                    </form.Field>
                  )}
                </form.Field>
              )}
            </form.Field>
          )}

          {step === "resources" && kind && (isSourceBased || isDocker) && (
            <form.Field name="presetId">
              {(presetIdField) => (
                <form.Field name="customCpu">
                  {(customCpuField) => (
                    <form.Field name="customMem">
                      {(customMemField) => (
                        <form.Field name="replicas">
                          {(replicasField) => (
                            <form.Field name="placement">
                              {(placementField) => (
                                <form.Field name="pinnedNodeId">
                                  {(pinnedNodeIdField) => (
                                    <StepResources
                                      presetIdField={presetIdField}
                                      customCpuField={customCpuField}
                                      customMemField={customMemField}
                                      replicasField={replicasField}
                                      placementField={placementField}
                                      pinnedNodeIdField={pinnedNodeIdField}
                                      isDb={false}
                                    />
                                  )}
                                </form.Field>
                              )}
                            </form.Field>
                          )}
                        </form.Field>
                      )}
                    </form.Field>
                  )}
                </form.Field>
              )}
            </form.Field>
          )}

          {step === "variables" && kind && (isSourceBased || isDocker) && (
            <form.Field name="variables">
              {(variablesField) => (
                <form.Field name="linkedSecrets">
                  {(linkedSecretsField) => (
                    <StepVariables
                      variablesField={variablesField}
                      linkedSecretsField={linkedSecretsField}
                      kind={kind}
                    />
                  )}
                </form.Field>
              )}
            </form.Field>
          )}

          {step === "review" && kind && (isSourceBased || isDocker) && (
            <form.Subscribe selector={(s) => s.values}>
              {(values) => <StepReview values={values} kind={kind} />}
            </form.Subscribe>
          )}

          {step === "version" && kind && isDb && (
            <form.Field name="version">
              {() => (
                <form.Field name="name">
                  {(nameField) => (
                    <StepVersion
                      kind={kind}
                      version={version}
                      setVersion={(v) => form.setFieldValue("version", v)}
                      nameField={nameField}
                    />
                  )}
                </form.Field>
              )}
            </form.Field>
          )}

          {step === "resources" && kind && isDb && (
            <form.Field name="presetId">
              {(presetIdField) => (
                <form.Field name="customCpu">
                  {(customCpuField) => (
                    <form.Field name="customMem">
                      {(customMemField) => (
                        <form.Field name="replicas">
                          {(replicasField) => (
                            <form.Field name="placement">
                              {(placementField) => (
                                <form.Field name="pinnedNodeId">
                                  {(pinnedNodeIdField) => (
                                    <StepResources
                                      presetIdField={presetIdField}
                                      customCpuField={customCpuField}
                                      customMemField={customMemField}
                                      replicasField={replicasField}
                                      placementField={placementField}
                                      pinnedNodeIdField={pinnedNodeIdField}
                                      isDb={isDb}
                                    />
                                  )}
                                </form.Field>
                              )}
                            </form.Field>
                          )}
                        </form.Field>
                      )}
                    </form.Field>
                  )}
                </form.Field>
              )}
            </form.Field>
          )}

          {step === "storage" && kind && isDb && (
            <form.Field name="storageGb">
              {(storageGbField) => (
                <form.Field name="backupsEnabled">
                  {(backupsEnabledField) => (
                    <form.Field name="backupRetention">
                      {(backupRetentionField) => (
                        <form.Field name="pitr">
                          {(pitrField) => (
                            <form.Field name="highAvailability">
                              {(highAvailabilityField) => (
                                <StepStorage
                                  storageGbField={storageGbField}
                                  backupsEnabledField={backupsEnabledField}
                                  backupRetentionField={backupRetentionField}
                                  pitrField={pitrField}
                                  highAvailabilityField={highAvailabilityField}
                                  kind={kind}
                                />
                              )}
                            </form.Field>
                          )}
                        </form.Field>
                      )}
                    </form.Field>
                  )}
                </form.Field>
              )}
            </form.Field>
          )}

          {step === "advanced" && kind && isDb && <StepAdvancedDb kind={kind} />}

          {step === "review" && kind && isDb && (
            <form.Subscribe selector={(s) => s.values}>
              {(values) => <StepReview values={values} kind={kind} />}
            </form.Subscribe>
          )}
        </div>
      </div>

      <div
        className={`flex shrink-0 items-center gap-2 border-t ${
          layout === "page" ? "bg-card" : "bg-transparent"
        } ${layout === "dialog" ? "px-[18px] py-3" : "px-5 py-3"}`}
      >
        {layout === "page" ? (
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link to="/$orgSlug/$projectSlug" params={{ orgSlug, projectSlug }}>
              Cancel
            </Link>
          </Button>
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
        <div className="flex-1" />
        {idx > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={goPrev}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-3.5" />
            Back
          </Button>
        )}
        <Button
          size="sm"
          className="h-8 gap-1.5"
          onClick={handleContinue}
          disabled={!canAdvance}
        >
          {isLast ? "Create & deploy" : "Continue"}
          {!isLast && (
            <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}
