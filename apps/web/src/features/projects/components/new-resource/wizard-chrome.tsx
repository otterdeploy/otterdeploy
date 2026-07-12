import type { ProjectId } from "@otterdeploy/shared/id";

import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { ServiceKind } from "@/features/projects/data/service-kinds";

import { Button } from "@/shared/components/ui/button";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/shared/lib/utils";

import type { Step } from "./schemas";

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
} from "./steps";

// Which kinds the wizard actually knows how to submit. Hoisted out of
// the body so the 6-way disjunction doesn't pad ResourceWizardBody's
// cyclomatic complexity past the cap. Add new kinds here as their
// flows ship.
const WIRED_DB_KINDS = new Set(["postgres", "redis", "mariadb", "mongodb"]);
export function isKindWired(kindId: string, kind: ServiceKind | null): boolean {
  if (kindId === "docker") return true;
  if (WIRED_DB_KINDS.has(kindId)) return true;
  return kind?.group === "source";
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
  dbView: boolean;
  onDbViewChange: (open: boolean) => void;
}
const STEP_RENDERERS: Record<Step, (ctx: StepCtx) => React.ReactNode | null> = {
  kind: ({ dbView, onDbViewChange }) => (
    <StepKind dbView={dbView} onDbViewChange={onDbViewChange} />
  ),
  source: ({ kind, isSourceBased }) => (kind && isSourceBased ? <StepSource /> : null),
  builder: ({ kind, isSourceBased }) => (kind && isSourceBased ? <StepBuilder /> : null),
  image: ({ kind, isDocker }) => (kind && isDocker ? <StepImage /> : null),
  networking: ({ kind, isSourceBased, isDocker }) =>
    kind && (isSourceBased || isDocker) ? <StepNetworking kind={kind} /> : null,
  resources: ({ kind, isDb }) => (kind ? <StepResources isDb={isDb} /> : null),
  variables: ({ kind, isSourceBased, isDocker, projectId }) =>
    kind && (isSourceBased || isDocker) ? (
      <StepVariables kind={kind} projectId={projectId} />
    ) : null,
  version: ({ kind, isDb, projectId }) =>
    kind && isDb ? <StepVersion kind={kind} projectId={projectId} /> : null,
  storage: ({ kind, isDb }) => (kind && isDb ? <StepStorage kind={kind} /> : null),
  advanced: ({ kind, isDb }) => (kind && isDb ? <StepAdvancedDb kind={kind} /> : null),
  review: ({ kind }) => (kind ? <StepReview kind={kind} /> : null),
};

export function WizardStepBody({
  step,
  kind,
  isDb,
  isSourceBased,
  isDocker,
  projectId,
  dbView,
  onDbViewChange,
}: {
  step: Step;
  kind: ServiceKind | null;
  isDb: boolean;
  isSourceBased: boolean;
  isDocker: boolean;
  projectId: ProjectId;
  dbView: boolean;
  onDbViewChange: (open: boolean) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className={cn("mx-auto max-w-205", { "max-w-275": step === "kind" })}>
        {STEP_RENDERERS[step]({
          kind,
          isDb,
          isSourceBased,
          isDocker,
          projectId,
          dbView,
          onDbViewChange,
        })}
      </div>
    </div>
  );
}

export function RequiredHint({
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
            issues.flatMap((i) => {
              const p = i.path[0];
              return typeof p === "string" && p !== "__step" ? [p] : [];
            }),
          ),
        ).join(", ")}
      </span>
    </div>
  );
}

export function WizardFooter({
  onCancel,
  idx,
  isLast,
  isCreating,
  kind,
  kindWired,
  createDisabled,
  goPrev,
  handleContinue,
  showAdvancedToggle,
  advancedSetup,
  onAdvancedChange,
  showDbBack,
  onDbBack,
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
  showAdvancedToggle: boolean;
  advancedSetup: boolean;
  onAdvancedChange: (next: boolean) => void;
  /** In the database-engine sub-view of the Source step: render a Back that
   *  returns to the launch cards, sitting next to Continue. */
  showDbBack: boolean;
  onDbBack: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-t bg-transparent px-4 py-3">
      <Button variant="outline" size="sm" className="h-8" onClick={() => onCancel?.()}>
        Cancel
      </Button>
      {showAdvancedToggle && (
        <label className="ml-1 flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground select-none">
          <Switch checked={advancedSetup} onCheckedChange={onAdvancedChange} />
          Advanced setup
        </label>
      )}
      {isLast && !kindWired && kind && (
        <span className="mr-1 text-[11px] text-muted-foreground">
          {kind.name} provisioner isn't wired yet.
        </span>
      )}
      <div className="flex-1" />
      {(idx > 0 || showDbBack) && (
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={showDbBack ? onDbBack : goPrev}
          disabled={isCreating}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-3.5" />
          Back
        </Button>
      )}
      <Button
        size="sm"
        className="h-8 gap-1.5"
        onClick={() => handleContinue()}
        disabled={createDisabled}
      >
        {/* In the engine sub-view, kindId is empty until an engine is picked,
            which collapses the flow to one step — so guard the "Add resource"
            label behind !showDbBack and read "Continue" instead. */}
        {isLast && !showDbBack ? (isCreating ? "Adding…" : "Add resource") : "Continue"}
        {(!isLast || showDbBack) && (
          <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5" />
        )}
      </Button>
    </div>
  );
}
