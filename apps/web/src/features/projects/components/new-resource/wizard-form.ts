import { useEffect, useMemo } from "react";

import { useStore } from "@tanstack/react-form";

import { SERVICE_KINDS } from "@/features/projects/data/service-kinds";

import type { DatabaseCreatePayload, ServiceCreatePayload } from "./wizard-provisioner";

import { flowFor } from "./flows";
import { useAppForm } from "./form-context";
import { resourceDefaults, resourceFormSchema, type Step } from "./schemas";

/**
 * Owns the wizard form + everything derived from it: which step's
 * schema arm currently fails, which step the operator is on, what
 * `Continue` does. Hoisted out of ResourceWizardBody so it stays
 * under the file-length cap.
 *
 * The hook deliberately doesn't know about chrome/JSX — it only
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
      ...(initialKind ? { kindId: initialKind, name: initialKind } : {}),
      repo: initialGitRepoId ?? "",
      branch: initialBranch ?? "main",
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validators: { onChange: resourceFormSchema as any },
    onSubmit: async ({ value }) => {
      // Strip the wizard-only discriminator before passing fields to the API.
      const { __step: _drop, ...payload } = value;
      // Sizing is shared across every kind — preset id (or custom sliders).
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
          root: payload.root,
          ...sizing,
        });
        return;
      }
      // Compute kinds (app/worker/static/etc.): built by apps/builder from
      // the project's git binding. Placeholder image — the first build
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
        root: payload.root,
        ...sizing,
      });
    },
  });

  // Keep form's __step in sync with the URL/local step.
  useEffect(() => {
    form.setFieldValue("__step", step);
  }, [step, form]);

  const kindId = useStore(form.store, (s) => s.values.kindId);
  const kind = SERVICE_KINDS.find((k) => k.id === kindId) ?? null;
  const isDb = !!kind && kind.group === "database";
  const isSourceBased = !!kind && kind.group === "source";
  const isDocker = !!kind && kind.id === "docker";

  const advancedSetup = useStore(form.store, (s) => s.values.advancedSetup);
  const setAdvanced = (next: boolean) => form.setFieldValue("advancedSetup", next);
  const steps = useMemo(() => flowFor(kind, advancedSetup), [kind, advancedSetup]);
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
    const hasFieldErrors = Object.values(allErrors.fields).some((f) => f.errors.length > 0);
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
    advancedSetup,
    setAdvanced,
  };
}
