import type { DeepKeys } from "@tanstack/react-form";

import { useState } from "react";

import { useSelector } from "@tanstack/react-form";
import * as z from "zod";

import { SERVICE_KINDS } from "@/features/projects/data/service-kinds";

import type { DatabaseCreatePayload, ServiceCreatePayload } from "./wizard-provisioner";

import { flowFor } from "./flows";
import { useAppForm } from "./form-context";
import { DOCKER_PORT_DEFAULTS } from "./image-defaults";
import { resourceDefaults, resourceFormSchema, type ResourceFormState, type Step } from "./schemas";

/**
 * The step union's *input* type is the union of its arms, which the flat
 * `ResourceFormState` can never satisfy statically: its `__step` is the union
 * of every step literal even though each runtime probe matches exactly one
 * arm. Wrap the union in a schema whose declared input IS the form state and
 * which delegates validation to the union, so the form's validator slot
 * typechecks without an assertion while surfacing identical issues (same
 * paths, so field error mapping is unchanged).
 */
const resourceFormValidator = z.custom<ResourceFormState>().check((ctx) => {
  const parsed = resourceFormSchema.safeParse(ctx.value);
  if (parsed.success) return;
  for (const issue of parsed.error.issues) {
    // Re-emitted as `custom` issues: the standard-schema surface TanStack
    // reads carries only message + path, both preserved verbatim here.
    ctx.issues.push({
      code: "custom",
      path: [...issue.path],
      message: issue.message,
      input: ctx.value,
    });
  }
});

/**
 * Runtime check that `name` names a real path in the form's values, typed as
 * the `DeepKeys` guard `setFieldMeta` requires. Walks the value object one
 * segment at a time (both `a.b` and `a[0].b` spellings), so it genuinely
 * verifies the path exists instead of asserting it.
 */
function isFieldPath<TFormData>(
  values: TFormData,
  name: string,
): name is DeepKeys<TFormData> & string {
  let node: unknown = values;
  for (const segment of name.replace(/\[(\d+)\]/g, ".$1").split(".")) {
    if (Array.isArray(node)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= node.length) return false;
      node = node[index];
      continue;
    }
    if (typeof node !== "object" || node === null || !(segment in node)) return false;
    node = Object.getOwnPropertyDescriptor(node, segment)?.value;
  }
  return true;
}

/**
 * The wizard's final submit. Routes the collected fields to the right
 * provisioner. Module-level (not a closure inside the hook) so the hook
 * stays within the per-function line budget.
 */
async function submitWizard(
  value: ResourceFormState,
  runDatabaseCreate: (payload: DatabaseCreatePayload) => Promise<void>,
  runServiceCreate: (payload: ServiceCreatePayload) => Promise<void>,
): Promise<void> {
  // Strip the wizard-only discriminator before passing fields to the API.
  const { __step: _drop, ...payload } = value;
  // Sizing is shared across every kind, preset id (or custom sliders).
  const sizing = {
    presetId: payload.presetId,
    customCpu: payload.customCpu,
    customMem: payload.customMem,
  };
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
      // Extensions are postgres-only; other engines ignore the field.
      extensions: payload.kindId === "postgres" ? payload.extensions : [],
      version: payload.version,
      ...sizing,
    });
    return;
  }
  // Pre-built docker image: image step has `image` + `tag`.
  if (payload.kindId === "docker") {
    await runServiceCreate({
      name: payload.name,
      source: "image",
      kindId: payload.kindId,
      image: payload.tag ? `${payload.image}:${payload.tag}` : payload.image,
      ports: payload.ports,
      variables: payload.variables,
      replicas: payload.replicas,
      builderId: payload.builderId,
      spa: payload.spa,
      healthPath: payload.healthPath,
      healthInterval: payload.healthInterval,
      healthTimeout: payload.healthTimeout,
      healthRetries: payload.healthRetries,
      root: payload.root,
      ...sizing,
    });
    return;
  }
  // Compute kinds (app/worker/static/etc.): built by apps/builder from
  // the project's git binding. Placeholder image. The first build
  // overwrites it. A port-less kind (worker) skips the Networking step, so
  // force no ports rather than inheriting the default web port.
  const portless = SERVICE_KINDS.find((k) => k.id === payload.kindId)?.portless === true;
  await runServiceCreate({
    name: payload.name,
    source: "git",
    kindId: payload.kindId,
    image: "pending:initial",
    ports: portless ? [] : payload.ports,
    variables: payload.variables,
    replicas: payload.replicas,
    builderId: payload.builderId,
    spa: payload.spa,
    healthPath: payload.healthPath,
    healthInterval: payload.healthInterval,
    healthTimeout: payload.healthTimeout,
    healthRetries: payload.healthRetries,
    root: payload.root,
    // Bind the repo the operator picked. `repoFullName` mirrors the bound
    // repo's "owner/repo" (the `repo` field holds the opaque gitRepoId,
    // which the portable manifest can't use); branch "" → repo default.
    repo: payload.repoFullName || undefined,
    branch: payload.branch || undefined,
    gitRepoId: payload.repo || undefined,
    ...sizing,
  });
}

/**
 * Owns the wizard form + everything derived from it: which step's
 * schema arm currently fails, which step the operator is on, what
 * `Continue` does. Hoisted out of ResourceWizardBody so it stays
 * under the file-length cap.
 *
 * The hook deliberately doesn't know about chrome/JSX. It only
 * surfaces state. The body builds the layout from what it returns.
 */
export function useWizardForm({
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
  runDatabaseCreate: (payload: DatabaseCreatePayload) => Promise<void>;
  runServiceCreate: (payload: ServiceCreatePayload) => Promise<void>;
}) {
  const form = useAppForm({
    defaultValues: {
      ...resourceDefaults,
      __step: step,
      // Docker kind: name derives from the image basename (image step), not
      // the source kind: a service literally named "docker" helps nobody.
      // Its ports row starts empty too; the image step fills known defaults.
      ...(initialKind
        ? {
            kindId: initialKind,
            name: initialKind === "docker" ? "" : initialKind,
            ...(initialKind === "docker" ? { ports: DOCKER_PORT_DEFAULTS } : {}),
          }
        : {}),
      repo: initialGitRepoId ?? "",
      branch: initialBranch ?? "main",
    },
    validators: { onChange: resourceFormValidator },
    onSubmit: ({ value }) => submitWizard(value, runDatabaseCreate, runServiceCreate),
  });

  // The footer's "Required" strip only appears after the operator actually
  // tries to continue past an incomplete step, never preemptively on a
  // pristine step (raw "kindId" strips on open were pure noise).
  //
  // Stored as WHICH step was blocked, not a boolean, so "is the strip on"
  // is derived during render. A boolean would need resetting whenever the
  // step changed, which is what the effect here used to do, and an effect
  // that exists only to reset state on a prop change is a render the user
  // sees with the stale value still on screen.
  const [attemptedStep, setAttemptedStep] = useState<Step | null>(null);
  const attempted = attemptedStep === step;

  const kindId = useSelector(form.store, (s) => s.values.kindId);
  const kind = SERVICE_KINDS.find((k) => k.id === kindId) ?? null;
  const isDb = !!kind && kind.group === "database";
  const isSourceBased = !!kind && kind.group === "source";
  const isDocker = !!kind && kind.id === "docker";

  /**
   * Move to another step.
   *
   * `__step` is the discriminator the schema union switches on, so it changes
   * together with the step, in the handler that changes it. Every step change
   * goes through here: `goTo` is the owner's `setStep`, and the stepper rail
   * calls this same function, so there is no path that leaves the two out of
   * step, which is what the old sync effect was compensating for.
   */
  const goToStep = (next: Step) => {
    form.setFieldValue("__step", next);
    goTo(next);
  };

  const advancedSetup = useSelector(form.store, (s) => s.values.advancedSetup);
  const setAdvanced = (next: boolean) => form.setFieldValue("advancedSetup", next);
  const steps = flowFor(kind, advancedSetup);
  const idx = steps.findIndex((s) => s[0] === step);
  const isLast = idx === steps.length - 1;

  /**
   * Advance off the Source step the moment a source is chosen. Picking one IS
   * the answer that step asks for, so making the operator confirm it with a
   * second click is a step that exists only to be dismissed.
   *
   * Takes the id rather than reading `kind` from the store, and recomputes the
   * flow from it. The two must not be separated: `flowFor` branches on the
   * chosen kind, so step 1 is "source" for a git repo, "image" for Docker and
   * "version" for a database. Advancing via the render-time `steps` would use
   * the flow for the PREVIOUS kind: pick Docker after the default git flow and
   * you would land on the repository step for an image-based service.
   */
  const advanceAfterKind = (nextKindId: string) => {
    const nextKind = SERVICE_KINDS.find((k) => k.id === nextKindId) ?? null;
    const next = flowFor(nextKind, advancedSetup)[1]?.[0];
    if (next) goToStep(next);
  };

  // Failing steps the user has PASSED (i < idx). The current step is
  // mid-edit; its blockers surface in the footer's "Required" line.
  const formValues = useSelector(form.store, (s) => s.values);
  const failingSteps = new Set<Step>();
  steps.forEach(([id], i) => {
    if (i >= idx) return;
    const probe = { ...formValues, __step: id };
    if (!resourceFormSchema.safeParse(probe).success) failingSteps.add(id);
  });

  // Issues for the CURRENT step's arm. Feeds the footer's
  // "Required: …" hint so the operator always knows why Continue
  // won't advance.
  const currentStepParse = resourceFormSchema.safeParse({ ...formValues, __step: step });
  const currentStepIssues = currentStepParse.success ? [] : currentStepParse.error.issues;

  const handleContinue = async () => {
    // Validate against the CURRENT step's arm. __step is already set
    // `__step` already names the current step (goToStep set it on the way
    // in), so the union validator runs the right arm. Don't preemptively bump
    // it: that'd check the next arm against fields the user hasn't filled.
    await form.validate("change");
    const allErrors = form.getAllErrors();
    const hasFormErrors = allErrors.form.errors.length > 0;
    const hasFieldErrors = Object.values(allErrors.fields).some((f) => f.errors.length > 0);
    if (hasFormErrors || hasFieldErrors) {
      // Surface the blockers: the footer strip turns on, and every failing
      // field is marked blurred so its inline error renders (fields stay
      // quiet until blurred or a continue is attempted, no premature red).
      setAttemptedStep(step);
      for (const [fieldName, f] of Object.entries(allErrors.fields)) {
        if (f.errors.length > 0 && isFieldPath(formValues, fieldName)) {
          form.setFieldMeta(fieldName, (meta) => ({
            ...meta,
            isTouched: true,
            isBlurred: true,
          }));
        }
      }
      return;
    }
    if (isLast) {
      await form.handleSubmit();
    } else {
      goToStep(steps[idx + 1][0]);
    }
  };

  const goPrev = () => {
    if (idx > 0) goToStep(steps[idx - 1][0]);
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
    /** True once the operator tried to continue past the current step and
     *  validation blocked them: gates the footer's "Required" strip. */
    attempted,
    handleContinue,
    goPrev,
    goToStep,
    advanceAfterKind,
    advancedSetup,
    setAdvanced,
  };
}
