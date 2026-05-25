# New Resource Flow — Dialog & Overlay Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two alternative UX surfaces for creating a new resource — variant A (kind-picker dialog → page wizard) and variant B (full overlay wizard) — alongside the existing page-route flow, so all three can be compared on the project page.

**Architecture:** Extract the wizard logic from the existing route into a reusable `<NewResourceWizard>` component, then build two thin Dialog-based wrappers that compose it. Existing `/new-resource` route keeps working but gains a `?kind=` search param so variant A can deep-link past step-kind.

**Tech Stack:** React 19, TanStack Router (file-based), TanStack Form + Zod, shadcn Dialog (Base UI under the hood), Tailwind v4. No automated tests added per spec — verification is `bunx tsc --noEmit` plus manual browser checks.

**Spec:** `docs/superpowers/specs/2026-05-24-new-resource-flow-variants-design.md`

---

## File Structure

**New files:**
- `apps/web/src/features/projects/components/new-resource/new-resource-wizard.tsx` — extracted wizard component (form state + stepper + step rendering + footer). Renders identically in `layout="page"` and `layout="dialog"` aside from chrome.
- `apps/web/src/features/projects/components/new-resource/new-resource-dialogs.tsx` — exports `<NewResourceKindDialog>` (variant A) and `<NewResourceOverlayDialog>` (variant B).

**Modified files:**
- `apps/web/src/routes/_app/$orgSlug/$projectSlug/new-resource.tsx` — shrinks to a thin route wrapper; adds `validateSearch` for `?kind=`.
- `apps/web/src/routes/_app/$orgSlug/$projectSlug/index.tsx` — adds two new trigger buttons alongside the existing `+ Add resource` Link.

**Untouched:**
- All `apps/web/src/features/projects/components/new-resource/step-*.tsx` files.
- `stepper.tsx`, `schema.ts`, `form-primitives.tsx`, `icons.tsx`.

---

## Task 1: Extract `<NewResourceWizard>` component (zero behavior change)

**Files:**
- Create: `apps/web/src/features/projects/components/new-resource/new-resource-wizard.tsx`
- Modify: `apps/web/src/routes/_app/$orgSlug/$projectSlug/new-resource.tsx`

### Context

The current route file is 379 lines. Lines 38–379 are the `RouteComponent` function — form state, step nav, step rendering, header chrome, stepper, body, footer buttons. Move everything inside `RouteComponent` (the part that does wizard work, not the loader plumbing) into a new component. The route then becomes a thin wrapper that reads loaders and passes props to the wizard.

The wizard component must accept a `layout` prop (`"page" | "dialog"`) for Task 4 to use it inside a Dialog. In Task 1 we only need the `"page"` branch — but define the prop now so Task 4 can fill in the `"dialog"` branch without rewriting the API.

- [ ] **Step 1: Create the new wizard component file**

Create `apps/web/src/features/projects/components/new-resource/new-resource-wizard.tsx` with the following content. The body of `WizardContent` is the existing `RouteComponent` body from `new-resource.tsx:46–376` with three changes:
1. Loader hooks (`useLoaderData`) are removed — `orgSlug`, `projectSlug`, `project.name` come from props.
2. The initial `step` state uses `initialStep` prop with a default of `"kind"`.
3. The form's `defaultValues` merges `initialKind` into `resourceDefaults` when provided.

```tsx
// Wizard component — extracted from routes/_app/$orgSlug/$projectSlug/new-resource.tsx
// so the same wizard can render inside a Dialog (variant B) and the route page.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
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

const DB_STEPS: Array<[Step, string, string]> = [
  ["kind", "Kind", "pick-kind"],
  ["version", "Version", "pick-version"],
  ["resources", "Resources", "pick-resources"],
  ["storage", "Storage & backups", "storage"],
  ["advanced", "Advanced", "advanced"],
  ["review", "Review", "review"],
];

const KIND_STEPS: Array<[Step, string, string]> = [
  ["kind", "Kind", "pick-kind"],
];

export type NewResourceWizardProps = {
  orgSlug: string;
  projectSlug: Slug<typeof ID_PREFIX.project>;
  projectName: string;
  initialKind?: string | null;
  initialStep?: Step;
  onComplete?: () => void;
  onCancel?: () => void;
  layout?: "page" | "dialog";
};

export function NewResourceWizard({
  orgSlug,
  projectSlug,
  projectName,
  initialKind = null,
  initialStep,
  onComplete,
  onCancel,
  layout = "page",
}: NewResourceWizardProps) {
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

  const canAdvance: boolean = (() => {
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
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: layout === "page" ? "var(--background)" : "transparent",
        color: "var(--foreground)",
      }}
    >
      {showChrome && (
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
            <svg viewBox="0 0 16 16" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 4l-4 4 4 4" />
            </svg>
            {projectName}
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
      )}

      <Stepper steps={steps} idx={idx} setStep={setStep} />

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: layout === "dialog" ? "16px 18px" : 22,
        }}
        className="os-scroll"
      >
        <div style={{ maxWidth: step === "kind" ? 1100 : 820, margin: "0 auto" }}>
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

          {step !== "kind" && !isDb && (
            <div style={{ padding: 32, textAlign: "center", color: "var(--muted-foreground)", fontSize: 14 }}>
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
                                <StepResources
                                  presetIdField={presetIdField}
                                  customCpuField={customCpuField}
                                  customMemField={customMemField}
                                  replicasField={replicasField}
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
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: layout === "dialog" ? "12px 18px" : "12px 22px",
          borderTop: "1px solid var(--border)",
          background: layout === "page" ? "var(--card)" : "transparent",
          flexShrink: 0,
        }}
      >
        {layout === "page" ? (
          <Link
            to="/$orgSlug/$projectSlug"
            params={{ orgSlug, projectSlug }}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              height: 32, padding: "0 14px", borderRadius: 6,
              border: "1px solid var(--border)", background: "var(--background)",
              color: "var(--foreground)", fontSize: 13, fontWeight: 500,
              textDecoration: "none", cursor: "pointer",
            }}
          >
            Cancel
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => onCancel?.()}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              height: 32, padding: "0 14px", borderRadius: 6,
              border: "1px solid var(--border)", background: "var(--background)",
              color: "var(--foreground)", fontSize: 13, fontWeight: 500,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
        )}
        <div style={{ flex: 1 }} />
        {idx > 0 && (
          <button
            type="button"
            onClick={goPrev}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              height: 32, padding: "0 14px", borderRadius: 6,
              border: "1px solid var(--border)", background: "var(--background)",
              color: "var(--foreground)", fontSize: 13, fontWeight: 500,
              cursor: "pointer", fontFamily: "inherit",
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
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            height: 32, padding: "0 14px", borderRadius: 6,
            border: "1px solid transparent", background: "var(--foreground)",
            color: "var(--background)", fontSize: 13, fontWeight: 500,
            cursor: canAdvance ? "pointer" : "not-allowed",
            opacity: canAdvance ? 1 : 0.45, fontFamily: "inherit",
          }}
        >
          {isLast ? "Create & deploy" : "Continue →"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace the route's `RouteComponent` with a thin wrapper**

Open `apps/web/src/routes/_app/$orgSlug/$projectSlug/new-resource.tsx`. Replace the entire file contents with:

```tsx
import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { NewResourceWizard } from "@/features/projects/components/new-resource/new-resource-wizard";
import { ID_PREFIX, type Slug } from "@otterstack/shared/id";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/new-resource")({
  staticData: { crumb: "New resource" },
  component: RouteComponent,
});

function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });

  return (
    <NewResourceWizard
      layout="page"
      orgSlug={organization.slug}
      projectSlug={project.slug as Slug<typeof ID_PREFIX.project>}
      projectName={project.name}
    />
  );
}
```

- [ ] **Step 3: Typecheck**

Run from the repo root:

```bash
bunx --cwd apps/web tsc --noEmit 2>&1 | grep -E "new-resource-wizard|new-resource\.tsx" || echo "OK: no errors in touched files"
```

Expected: `OK: no errors in touched files`. Pre-existing errors in unrelated files (sidebar routes, swarm/postgres) are fine and out of scope.

- [ ] **Step 4: Manual verification — original page wizard still works**

Open `https://otterstack-demo-1.pages.dev/project/proj_acme` (or local dev equivalent), click `+ Add resource`. The page should look and behave identically to before this task — header chrome with project name and "Step 1 of N", the kind picker with 4 tabs, Continue button disabled until a kind is picked, full multi-step flow for postgres.

If anything looks different, stop and reconcile against the original `new-resource.tsx:38–379` you replaced.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/projects/components/new-resource/new-resource-wizard.tsx \
        apps/web/src/routes/_app/\$orgSlug/\$projectSlug/new-resource.tsx
git commit -m "$(cat <<'EOF'
refactor(web): extract NewResourceWizard from new-resource route

No behavior change. Pulls form state, step nav, step rendering, and chrome
out of the route's RouteComponent so the same wizard can render inside a
Dialog. The route shrinks to a thin wrapper; layout="page" preserves the
original chrome verbatim.
EOF
)"
```

---

## Task 2: Add `?kind=` search param for deep-linking past step-kind

**Files:**
- Modify: `apps/web/src/routes/_app/$orgSlug/$projectSlug/new-resource.tsx`

### Context

Variant A's dialog navigates to `/new-resource?kind=<id>` so the page can skip the kind picker. This task wires the search-param contract on the route side. Pattern reference: `apps/web/src/routes/_app/$orgSlug/$projectSlug/layout.tsx:16–37` uses `validateSearch: zEnvSearch` with `Route.useSearch()`.

- [ ] **Step 1: Add `validateSearch` and pass `initialKind`/`initialStep` to the wizard**

Replace the file contents from Task 1 with:

```tsx
import { z } from "zod";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { NewResourceWizard } from "@/features/projects/components/new-resource/new-resource-wizard";
import { ID_PREFIX, type Slug } from "@otterstack/shared/id";

const zNewResourceSearch = z.object({ kind: z.string().optional() });

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/new-resource")({
  staticData: { crumb: "New resource" },
  validateSearch: zNewResourceSearch,
  component: RouteComponent,
});

function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });
  const { kind } = Route.useSearch();

  return (
    <NewResourceWizard
      layout="page"
      orgSlug={organization.slug}
      projectSlug={project.slug as Slug<typeof ID_PREFIX.project>}
      projectName={project.name}
      initialKind={kind ?? null}
      initialStep={kind ? "version" : "kind"}
    />
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
bunx --cwd apps/web tsc --noEmit 2>&1 | grep -E "new-resource\.tsx" || echo "OK"
```

Expected: `OK`.

- [ ] **Step 3: Manual verification — deep link works**

In the running app, visit `/.../new-resource?kind=postgres` directly. The wizard should mount on step-version with the postgres kind pre-selected (the version cards should be `postgres 16.4`, `postgres 16.3`, etc., not the 4-tab kind picker).

Visit `/.../new-resource` with no query string — wizard should mount on step-kind as before.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/_app/\$orgSlug/\$projectSlug/new-resource.tsx
git commit -m "$(cat <<'EOF'
feat(web): add ?kind= search param to new-resource route

Deep-links the wizard past step-kind when a kind is provided. Enables
variant-A's dialog kind-picker to hand off to the page wizard with the
selection already made.
EOF
)"
```

---

## Task 3: Build `<NewResourceKindDialog>` (variant A)

**Files:**
- Create: `apps/web/src/features/projects/components/new-resource/new-resource-dialogs.tsx`

### Context

Variant A is a dialog that shows the existing `<StepKind>` picker, then on confirm navigates to `/new-resource?kind=<id>` and closes itself. Reuses `StepKind` as-is per spec. The `Dialog` primitive is `apps/web/src/shared/components/ui/dialog.tsx` (Base UI under the hood). `DialogContent` defaults to `sm:max-w-sm` — we override with a wider class for the picker, which has 4 tabs and 3-column kind grid.

- [ ] **Step 1: Create the dialogs file with variant A only**

Create `apps/web/src/features/projects/components/new-resource/new-resource-dialogs.tsx`:

```tsx
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { StepKind } from "@/features/projects/components/new-resource/step-kind";
import { ID_PREFIX, type Slug } from "@otterstack/shared/id";

type NewResourceKindDialogProps = {
  orgSlug: string;
  projectSlug: Slug<typeof ID_PREFIX.project>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function NewResourceKindDialog({
  orgSlug,
  projectSlug,
  open,
  onOpenChange,
}: NewResourceKindDialogProps) {
  const navigate = useNavigate();
  const [kindId, setKindId] = useState<string | null>(null);

  const handleConfirm = () => {
    if (!kindId) return;
    void navigate({
      to: "/$orgSlug/$projectSlug/new-resource",
      params: { orgSlug, projectSlug },
      search: { kind: kindId },
    });
    onOpenChange(false);
    setKindId(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setKindId(null);
      }}
    >
      <DialogContent className="sm:max-w-[920px] max-h-[85vh] overflow-hidden flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle>Choose a resource type</DialogTitle>
          <DialogDescription>
            What kind of thing do you want to add to this project?
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-5 pb-3 os-scroll">
          <StepKind kindId={kindId} setKindId={setKindId} />
        </div>
        <DialogFooter className="m-0 rounded-none border-t bg-card px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!kindId}>
            Configure →
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
bunx --cwd apps/web tsc --noEmit 2>&1 | grep -E "new-resource-dialogs" || echo "OK"
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/projects/components/new-resource/new-resource-dialogs.tsx
git commit -m "$(cat <<'EOF'
feat(web): add NewResourceKindDialog (variant A)

Dialog wraps the existing StepKind picker; on confirm navigates to
/new-resource?kind=<id> and closes. Wider than the default dialog
(max-w-[920px]) to accommodate the 4-tab kind picker.
EOF
)"
```

---

## Task 4: Add `<NewResourceOverlayDialog>` (variant B)

**Files:**
- Modify: `apps/web/src/features/projects/components/new-resource/new-resource-dialogs.tsx`

### Context

Variant B renders the whole `<NewResourceWizard layout="dialog">` inside a large Dialog. The wizard already handles `layout="dialog"` (Task 1). The Dialog needs an explicit height so the internal scroll area works — without it, the wizard's `flex: 1; overflowY: auto` body has nothing to fill against.

- [ ] **Step 1: Add the overlay dialog component**

Append the following to `apps/web/src/features/projects/components/new-resource/new-resource-dialogs.tsx` (keep the existing variant-A code; just add new imports and the new component below it):

Update imports at the top of the file to also import the wizard:

```tsx
import { NewResourceWizard } from "@/features/projects/components/new-resource/new-resource-wizard";
```

Append at the bottom of the file:

```tsx
type NewResourceOverlayDialogProps = {
  orgSlug: string;
  projectSlug: Slug<typeof ID_PREFIX.project>;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function NewResourceOverlayDialog({
  orgSlug,
  projectSlug,
  projectName,
  open,
  onOpenChange,
}: NewResourceOverlayDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[920px] h-[80vh] overflow-hidden flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-4 pb-3 border-b">
          <DialogTitle>Add resource to {projectName}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          <NewResourceWizard
            layout="dialog"
            orgSlug={orgSlug}
            projectSlug={projectSlug}
            projectName={projectName}
            onComplete={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
bunx --cwd apps/web tsc --noEmit 2>&1 | grep -E "new-resource-dialogs|new-resource-wizard" || echo "OK"
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/projects/components/new-resource/new-resource-dialogs.tsx
git commit -m "$(cat <<'EOF'
feat(web): add NewResourceOverlayDialog (variant B)

Renders the full NewResourceWizard inside a large centered Dialog
(max-w-[920px], h-[80vh]) with layout="dialog". Esc/backdrop/Cancel
close the dialog; form state is discarded on close per v1 spec.
EOF
)"
```

---

## Task 5: Wire all three trigger buttons on the project page

**Files:**
- Modify: `apps/web/src/routes/_app/$orgSlug/$projectSlug/index.tsx`

### Context

Add two new trigger buttons next to the existing `+ Add resource` Link. All three styled identically so the only variable in the comparison is the flow itself. Each new trigger is a `<button>` (not a `<Link>`) that flips local `useState` to open its dialog.

- [ ] **Step 1: Replace the file contents**

Replace `apps/web/src/routes/_app/$orgSlug/$projectSlug/index.tsx` entirely with:

```tsx
import { useState } from "react";
import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";

import {
  NewResourceKindDialog,
  NewResourceOverlayDialog,
} from "@/features/projects/components/new-resource/new-resource-dialogs";
import { ID_PREFIX, type Slug } from "@otterstack/shared/id";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/")({
  staticData: { crumb: "Overview" },
  component: RouteComponent,
});

function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });

  const [kindDialogOpen, setKindDialogOpen] = useState(false);
  const [overlayDialogOpen, setOverlayDialogOpen] = useState(false);

  const orgSlug = organization.slug;
  const projectSlug = project.slug as Slug<typeof ID_PREFIX.project>;

  const triggerClass =
    "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent";

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">{project.name}</h1>
      <p className="text-muted-foreground">Project overview / control plane.</p>

      <Link
        params={{ orgSlug, projectSlug }}
        to="/$orgSlug/$projectSlug/graph"
      >
        <button>Go to {project.name}</button>
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          params={{ orgSlug, projectSlug }}
          to="/$orgSlug/$projectSlug/new-resource"
          className={triggerClass}
        >
          + Add resource
        </Link>
        <button
          type="button"
          onClick={() => setKindDialogOpen(true)}
          className={triggerClass}
        >
          + Add (dialog)
        </button>
        <button
          type="button"
          onClick={() => setOverlayDialogOpen(true)}
          className={triggerClass}
        >
          + Add (overlay)
        </button>
      </div>

      <NewResourceKindDialog
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        open={kindDialogOpen}
        onOpenChange={setKindDialogOpen}
      />
      <NewResourceOverlayDialog
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        projectName={project.name}
        open={overlayDialogOpen}
        onOpenChange={setOverlayDialogOpen}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
bunx --cwd apps/web tsc --noEmit 2>&1 | grep -E "projectSlug/index\.tsx" || echo "OK"
```

Expected: `OK`.

- [ ] **Step 3: Manual verification — all three flows work**

In a running dev server (or the deployed demo), navigate to a project page and exercise each trigger:

1. **`+ Add resource`** (original) → routes to `/new-resource`, page wizard mounts at step-kind. No regression versus today.
2. **`+ Add (dialog)`** → dialog opens with the 4-tab kind picker.
   - Cancel button closes with no nav.
   - Pick `postgres` → Configure enables → click Configure → URL changes to `/new-resource?kind=postgres`, dialog closes, page wizard mounts on step-version with postgres preselected.
3. **`+ Add (overlay)`** → large dialog opens with the wizard inside. Stepper visible at top, kind picker fills the body, footer has Cancel/Continue.
   - Pick postgres → Continue advances to step-version inside the same dialog.
   - Complete the wizard end-to-end → "Create & deploy" closes the dialog.
   - Esc / backdrop click / Cancel button all close the dialog.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/_app/\$orgSlug/\$projectSlug/index.tsx
git commit -m "$(cat <<'EOF'
feat(web): add dialog + overlay triggers alongside Add resource

Project page now exposes three buttons styled identically:
  - + Add resource  (original page-route flow, untouched)
  - + Add (dialog)  (variant A: kind picker dialog → page wizard)
  - + Add (overlay) (variant B: full wizard inside a centered Dialog)

Lets us compare the three flows side by side before picking one.
EOF
)"
```

---

## Self-Review

**Spec coverage:**

- Architecture file 1 (`new-resource-wizard.tsx`) → Task 1 ✓
- Architecture file 2 (`new-resource-dialogs.tsx`) → Tasks 3 & 4 ✓
- Architecture file 3 (route refactor + `?kind=` search param) → Tasks 1 & 2 ✓
- Architecture file 4 (project page triggers) → Task 5 ✓
- Variant A flow (dialog → page deep-link) → Task 3 navigation + Task 2 search param ✓
- Variant B flow (full overlay wizard) → Task 4 ✓
- "Existing `+ Add resource` untouched" → Task 5 preserves the Link verbatim with the same className ✓
- "All existing step components reused unchanged" → No step-*.tsx in any modify list ✓
- Out-of-scope items (no Create wiring, no confirm-on-close, no mobile work) → respected — `onComplete` defaults to navigate-on-page and dialog-close-on-overlay; no confirmation prompt added ✓

**Placeholder scan:** No TBD/TODO/"similar to" — every step has concrete code and exact commands.

**Type consistency:**
- `NewResourceWizardProps.projectName: string` defined in Task 1, passed by route (Task 1), variant B dialog (Task 4), and project page (Task 5). Variant A doesn't render the wizard so doesn't need it. ✓
- `Slug<typeof ID_PREFIX.project>` used consistently across all four files. ✓
- `NewResourceKindDialog` and `NewResourceOverlayDialog` exports in Task 3 and Task 4 match the imports in Task 5. ✓
- Search param key `kind` matches between `zNewResourceSearch` (Task 2) and the `navigate({ search: { kind: kindId } })` call (Task 3). ✓

No issues found.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-24-new-resource-flow-variants.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session, batch with checkpoints for review.

Which approach?
