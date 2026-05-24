// New resource creation — Pass B: multi-step wizard, database path.
// State lifted into tanstack-form + zod. Step nav is local useState (UI state).
import { useMemo, useState } from "react";
import { createFileRoute, Link, useLoaderData, useNavigate } from "@tanstack/react-router";
import { useForm, useStore } from "@tanstack/react-form";

import { StepKind } from "@/features/projects/components/new-resource/step-kind";
import { StepVersion } from "@/features/projects/components/new-resource/step-version";
import { StepResources } from "@/features/projects/components/new-resource/step-resources";
import { StepStorage } from "@/features/projects/components/new-resource/step-storage";
import { StepAdvancedDb } from "@/features/projects/components/new-resource/step-advanced-db";
import { StepReview } from "@/features/projects/components/new-resource/step-review";
import { Stepper, type Step } from "@/features/projects/components/new-resource/stepper";
import { SERVICE_KINDS } from "@/features/projects/data/service-kinds";
import { resourceSchema, resourceDefaults } from "@/features/projects/components/new-resource/schema";
import { ID_PREFIX, type Slug } from "@otterstack/shared/id";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/new-resource")({
  staticData: { crumb: "New resource" },
  component: RouteComponent,
});

// DB wizard step sequence
const DB_STEPS: Array<[Step, string, string]> = [
  ["kind", "Kind", "pick-kind"],
  ["version", "Version", "pick-version"],
  ["resources", "Resources", "pick-resources"],
  ["storage", "Storage & backups", "storage"],
  ["advanced", "Advanced", "advanced"],
  ["review", "Review", "review"],
];

// Fallback steps for non-database kinds
const KIND_STEPS: Array<[Step, string, string]> = [
  ["kind", "Kind", "pick-kind"],
];

function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });
  const navigate = useNavigate();

  const orgSlug = organization.slug;
  const projectSlug = project.slug as Slug<typeof ID_PREFIX.project>;

  const [step, setStep] = useState<Step>("kind");

  const form = useForm({
    defaultValues: resourceDefaults,
    validators: { onChange: resourceSchema },
    onSubmit: async ({ value }) => {
      console.log("submit", value);
      void navigate({ to: "/$orgSlug/$projectSlug", params: { orgSlug, projectSlug } });
    },
  });

  // Read reactive values from the store
  const kindId = useStore(form.store, (s) => s.values.kindId);
  const version = useStore(form.store, (s) => s.values.version);
  const formErrors = useStore(form.store, (s) => s.errors);

  const kind = SERVICE_KINDS.find((k) => k.id === kindId) ?? null;
  const isDb = !!kind && kind.group === "data";

  const steps = useMemo<Array<[Step, string, string]>>(() => {
    if (!kind) return KIND_STEPS;
    if (isDb) return DB_STEPS;
    return KIND_STEPS;
  }, [kind, isDb]);

  const idx = steps.findIndex((s) => s[0] === step);
  const isLast = idx === steps.length - 1;

  const goNext = () => {
    if (idx < steps.length - 1) setStep(steps[idx + 1][0]);
  };
  const goPrev = () => {
    if (idx > 0) setStep(steps[idx - 1][0]);
  };

  // Per-step advance gate
  const canAdvance: boolean = (() => {
    if (step === "kind") return !!kindId;
    if (step === "version") return !!version && version.length > 0;
    // resources, storage, advanced: always allow (no required fields beyond defaults)
    return true;
  })();

  const handleContinue = () => {
    if (isLast) {
      void form.handleSubmit();
    } else {
      goNext();
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 22px",
          borderBottom: "1px solid var(--border)",
          background: "var(--card)",
          flexShrink: 0,
        }}
      >
        <Link
          to="/$orgSlug/$projectSlug"
          params={{ orgSlug, projectSlug }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--muted-foreground)",
            textDecoration: "none",
          }}
        >
          <svg
            viewBox="0 0 16 16"
            width={12}
            height={12}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 4l-4 4 4 4" />
          </svg>
          {project.name}
        </Link>
        <span style={{ color: "var(--border)", fontSize: 14 }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Create resource</span>
        {kind && (
          <span className="os-muted os-mono" style={{ marginLeft: 4, fontSize: 11 }}>
            · {kind.name}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <span className="os-muted" style={{ fontSize: 11 }}>
          Step {idx + 1} of {steps.length}
        </span>
      </div>

      {/* Stepper */}
      <Stepper steps={steps} idx={idx} setStep={setStep} />

      {/* Body — scrollable */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 22,
        }}
        className="os-scroll"
      >
        <div style={{ maxWidth: step === "kind" ? 1100 : 820, margin: "0 auto" }}>
          {step === "kind" && (
            <StepKind
              kindId={kindId}
              setKindId={(id) => {
                form.setFieldValue("kindId", id);
                // Auto-set name and first version when kind is picked
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

          {step !== "kind" && !isDb && (
            <div
              style={{
                padding: 32,
                textAlign: "center",
                color: "var(--muted-foreground)",
                fontSize: 14,
              }}
            >
              Coming soon for {kind?.group ?? "this"} resources
            </div>
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
            <>
              <form.Field name="presetId">
                {(presetIdField) => (
                  <form.Field name="customCpu">
                    {(customCpuField) => (
                      <form.Field name="customMem">
                        {(customMemField) => (
                          <form.Field name="replicas">
                            {(replicasField) => (
                              <form.Field name="region">
                                {(regionField) => (
                                  <form.Field name="placement">
                                    {(placementField) => (
                                      <StepResources
                                        presetIdField={presetIdField}
                                        customCpuField={customCpuField}
                                        customMemField={customMemField}
                                        replicasField={replicasField}
                                        regionField={regionField}
                                        placementField={placementField}
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
            </>
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

          {step === "advanced" && kind && isDb && (
            <StepAdvancedDb kind={kind} />
          )}

          {step === "review" && kind && isDb && (
            <form.Subscribe selector={(s) => s.values}>
              {(values) => <StepReview values={values} kind={kind} />}
            </form.Subscribe>
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 22px",
          borderTop: "1px solid var(--border)",
          background: "var(--card)",
          flexShrink: 0,
        }}
      >
        <Link
          to="/$orgSlug/$projectSlug"
          params={{ orgSlug, projectSlug }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: 32,
            padding: "0 14px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--background)",
            color: "var(--foreground)",
            fontSize: 13,
            fontWeight: 500,
            textDecoration: "none",
            cursor: "pointer",
          }}
        >
          Cancel
        </Link>
        <div style={{ flex: 1 }} />
        {idx > 0 && (
          <button
            type="button"
            onClick={goPrev}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              height: 32,
              padding: "0 14px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--background)",
              color: "var(--foreground)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            ← Back
          </button>
        )}
        <button
          type="button"
          onClick={handleContinue}
          disabled={!canAdvance}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: 32,
            padding: "0 14px",
            borderRadius: 6,
            border: "1px solid transparent",
            background: "var(--foreground)",
            color: "var(--background)",
            fontSize: 13,
            fontWeight: 500,
            cursor: canAdvance ? "pointer" : "not-allowed",
            opacity: canAdvance ? 1 : 0.45,
            fontFamily: "inherit",
          }}
        >
          {isLast ? "Create & deploy" : "Continue →"}
        </button>
      </div>
    </div>
  );
}
