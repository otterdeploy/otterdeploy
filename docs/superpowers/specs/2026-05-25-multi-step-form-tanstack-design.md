# Multi-Step Resource Wizard — TanStack Form Refactor

## Problem

The `ResourceWizard` in `apps/web/src/features/projects/components/new-resource/` already runs on TanStack Form, but three things are painful enough to rework:

1. **Step components take `AnyFieldApi` props.** The wizard wraps every step in nested `<form.Field>` render-prop pyramids — `step: source` is seven `form.Field` calls deep (`src → repo → branch → root → autoDeploy → previewBranches → name → component`). Adding a field to a step means editing the wizard, the step props interface, and the step body. Field names are untyped (`AnyFieldApi`).
2. **No per-step validation gate.** The form is configured with `validators: { onChange: resourceSchema }`, so the entire schema validates on every keystroke regardless of which step is visible. `canAdvance` is hand-rolled for `kind` and `version` only — every other step's "Continue" lets invalid data through and surfaces it later (or not at all).
3. **Step state in `useState` only.** Browser refresh, back/forward, and deep-linking all reset the wizard to `step: kind`. There is no way to share a URL pointing at a specific step.

Branching (DB / source / docker step lists) is fine as-is — out of scope to rework.

## Scope

Refactor the new-resource wizard so step components own their layout but never receive field props, per-step validation gates Continue, and the active step lives in the URL. The page route and the dialog/overlay variants must keep working.

**Out of scope for v1:**

- Persisting form values across page refresh (only the step id is persisted, via the URL). Values reset on reload until we add sessionStorage in a follow-up.
- Wiring Create to the real `resource.create` oRPC procedure — the current `onSubmit` `console.log` no-op stays.
- Mobile-specific stepper redesign.
- Touching the branching flow shape (still DB vs source vs docker step arrays).

## Architecture

### File layout

```
features/projects/components/new-resource/
├── form-context.ts            NEW   createFormHookContexts + useAppForm + bound field registry
├── form-fields/               NEW   bound field components (one per primitive)
│   ├── text-field.tsx
│   ├── number-field.tsx
│   ├── switch-field.tsx
│   ├── select-field.tsx
│   ├── ports-field.tsx
│   ├── variables-field.tsx
│   ├── linked-secrets-field.tsx
│   └── submit-button.tsx
├── schemas/                   NEW   per-step Zod sub-schemas
│   ├── kind.ts
│   ├── source.ts
│   ├── builder.ts
│   ├── image.ts
│   ├── networking.ts
│   ├── resources.ts
│   ├── storage.ts
│   ├── variables.ts
│   ├── version.ts
│   └── index.ts               (resourceSchema = merged, STEP_SCHEMAS map, resourceDefaults)
├── steps/                     EXISTING — rewritten
│   ├── index.tsx              (Stepper + Step type + STEP_IDS + barrel exports)
│   ├── kind.tsx               (no props — uses useFormContext)
│   ├── source.tsx
│   ├── builder.tsx
│   ├── image.tsx
│   ├── version.tsx
│   ├── networking.tsx
│   ├── resources.tsx
│   ├── storage.tsx
│   ├── variables.tsx
│   ├── advanced-db.tsx
│   └── review.tsx             (form.Subscribe to render summary)
├── flows.ts                   NEW   DB_STEPS / SOURCE_STEPS / DOCKER_STEPS + flowFor(kind)
├── wizard.tsx                 RENAMED from new-resource-wizard.tsx
├── new-resource-dialogs.tsx   existing — unchanged
├── overlay-provider.tsx       existing — unchanged
├── form-primitives.tsx        existing — unchanged (SectionHeader, builderCardClass, etc.)
└── icons.tsx                  existing — unchanged
```

**Schema.ts at the package root is deleted** — replaced by `schemas/index.ts`.

### 1. `form-context.ts`

Wires TanStack Form's typed context once. Step files import `useFormContext`; every bound field component is registered here so `<form.AppField name="repo">{(f) => <f.TextField label="Repo" />}</form.AppField>` autocompletes the field-name and the bound primitive.

```ts
import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import { TextField } from "./form-fields/text-field";
import { NumberField } from "./form-fields/number-field";
import { SwitchField } from "./form-fields/switch-field";
import { SelectField } from "./form-fields/select-field";
import { PortsField } from "./form-fields/ports-field";
import { VariablesField } from "./form-fields/variables-field";
import { LinkedSecretsField } from "./form-fields/linked-secrets-field";
import { SubmitButton } from "./form-fields/submit-button";

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField, NumberField, SwitchField, SelectField,
    PortsField, VariablesField, LinkedSecretsField,
  },
  formComponents: { SubmitButton },
});
```

### 2. `form-fields/*`

One file per bound primitive. Each component pulls its field via `useFieldContext` and renders every error from `field.state.meta.errors` (the array — never `errors[0]`).

```tsx
// form-fields/text-field.tsx
import { useFieldContext } from "../form-context";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";

export function TextField({ label, type = "text", placeholder }: {
  label: string; type?: "text" | "password"; placeholder?: string;
}) {
  const field = useFieldContext<string>();
  const errors = field.state.meta.errors;
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        type={type}
        placeholder={placeholder}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        aria-invalid={errors.length > 0}
      />
      {errors.map((err, i) => (
        <FieldError key={i}>{String(err?.message ?? err)}</FieldError>
      ))}
    </Field>
  );
}
```

Composite fields (`PortsField`, `VariablesField`, `LinkedSecretsField`) follow the same pattern over arrays / records — the existing ~200-line variables table in `step-variables.tsx` moves into `form-fields/variables-field.tsx`, and the step file becomes a layout shell with `<SectionHeader>` + `<form.AppField name="variables">{(f) => <f.VariablesField />}</form.AppField>` + the linked-secrets card.

### 3. `schemas/*` — discriminated union on `__step`

The form carries a `__step` field whose value matches the current wizard step. `resourceFormSchema` is a `z.discriminatedUnion("__step", [...])` where each arm is the slice of requirements for one step. Each arm is **cumulative** — it requires every field needed up to and including that step. Arms are plain `z.object` (default `.strip()` behavior); extra fields the form is holding for later steps are silently ignored, which is exactly what we want.

This collapses three previously separate concepts into one:

- The per-step validation gate is just "set `__step` to the next step's id, run the form's validator, fail if there are issues."
- The "what's required for review" schema is the `review` arm.
- The stepper's "is this step failing" check is `safeParse` with `__step` set to that step's id.

There is no separate `STEP_SCHEMAS` map and no merged "global" schema beyond the union itself.

```ts
// schemas/kind.ts
import * as z from "zod";

export const kindStepSchema = z.object({
  __step: z.literal("kind"),
  kindId: z.string().min(1, "Select a resource type"),
});

// schemas/source.ts (cumulative through the source step)
export const sourceStepSchema = z.object({
  __step: z.literal("source"),
  kindId: z.string().min(1, "Select a resource type"),
  name: z
    .string()
    .slugify()
    .min(2, "Name must be at least 2 characters")
    .max(48, "Name must be 48 characters or fewer"),
  src: z.enum(["github", "gitlab"]),
  repo: z.string().min(1, "Repository is required"),
  branch: z.string().min(1, "Branch is required"),
  root: z.string(),
  autoDeploy: z.boolean(),
  previewBranches: z.boolean(),
});

// schemas/review.ts (everything required)
export const reviewStepSchema = z.object({
  __step: z.literal("review"),
  kindId: z.string().min(1),
  name: z.string().slugify().min(2).max(48),
  // ... every required field across every step
});

// schemas/index.ts
import * as z from "zod";
import { kindStepSchema } from "./kind";
import { sourceStepSchema } from "./source";
import { builderStepSchema } from "./builder";
import { imageStepSchema } from "./image";
import { versionStepSchema } from "./version";
import { networkingStepSchema } from "./networking";
import { resourcesStepSchema } from "./resources";
import { storageStepSchema } from "./storage";
import { variablesStepSchema } from "./variables";
import { advancedStepSchema } from "./advanced";
import { reviewStepSchema } from "./review";

export const resourceFormSchema = z.discriminatedUnion("__step", [
  kindStepSchema,
  sourceStepSchema,
  builderStepSchema,
  imageStepSchema,
  versionStepSchema,
  networkingStepSchema,
  resourcesStepSchema,
  storageStepSchema,
  variablesStepSchema,
  advancedStepSchema,
  reviewStepSchema,
]);

export type ResourceFormValues = z.infer<typeof resourceFormSchema>;

// The flat shape the form actually stores. The union narrows when validating,
// but the form holds every field at all times.
export type ResourceFormState = {
  __step: Step;
  kindId: string;
  name: string;
  version: string | null;
  src: "github" | "gitlab";
  repo: string; branch: string; root: string;
  autoDeploy: boolean; previewBranches: boolean;
  builderId: string;
  registry: string; image: string; tag: string;
  ports: Port[]; healthPath: string; healthInterval: number;
  variables: Var[]; linkedSecrets: Record<string, boolean>;
  presetId: string; customCpu: number; customMem: number;
  replicas: number; placement: string; pinnedNodeId: string | null;
  storageGb: number; backupsEnabled: boolean; backupRetention: number;
  pitr: boolean; highAvailability: boolean;
};

export const resourceDefaults: ResourceFormState = {
  __step: "kind",
  // ... same field defaults as today
};
```

**Why cumulative variants:** if the user jumps back to a prior step and clears a required value, advancing forward again must catch it. Cumulative variants do that automatically: validating the `source` arm checks `kindId` is still present, not just the source-specific fields.

**Why one type for state, another for validated:** `ResourceFormState` is the flat object the form stores. `ResourceFormValues` is the narrowed union (the type `z.infer` produces). UI code uses `ResourceFormState`; only the submit handler narrows.

### 4. The Continue gate

```ts
// wizard.tsx
const handleContinue = async () => {
  const nextStep = isLast ? "review" : steps[idx + 1][0];
  form.setFieldValue("__step", nextStep);
  const result = await form.validate("change");
  if (result.errors.length > 0) {
    // form.validate already populated field meta — leave __step on the next
    // step's id so the discriminated union keeps checking the right arm as
    // the user fixes issues. Stay on the current step visually.
    return;
  }
  if (isLast) {
    await form.handleSubmit();
  } else {
    goTo(nextStep);
  }
};
```

Because the form's `validators.onChange = resourceFormSchema` is wired at the root (see Section 5), changing `__step` automatically re-validates against the new arm. Bound fields re-render with `errors.map(...)` showing every issue per field.

The wizard root also subscribes to `form.state.values.__step` so the URL step and form `__step` stay in sync (effect: `useEffect(() => form.setFieldValue("__step", step), [step])`).

### 5. Wizard form setup

```ts
const form = useAppForm({
  defaultValues: resourceDefaults,
  validators: { onChange: resourceFormSchema, onSubmit: resourceFormSchema },
});
```

Both `onChange` and `onSubmit` use the same union — `onChange` is now safe because each arm only requires the slice of fields for the active step, so untouched fields don't generate errors. The user gets live feedback on the fields visible right now and nothing else.

**Stepper failure indicator:** the Stepper computes per-step failure by trial-parsing the union with the alternate `__step` value:

```ts
function stepHasErrors(values: ResourceFormState, stepId: Step): boolean {
  const probe = { ...values, __step: stepId };
  return !resourceFormSchema.safeParse(probe).success;
}
```

**Submit payload:** before sending to the backend, strip `__step`:

```ts
onSubmit: async ({ value }) => {
  const { __step: _, ...payload } = value;
  await createResource(payload);
}
```

### 6. `wizard.tsx` + `flows.ts`

The wizard pulls the flow from `flowFor(kind)` rather than holding the branching logic inline. Each step body shrinks to a single line.

```ts
// flows.ts
export const KIND_STEPS: Array<[Step, string]> = [["kind", "Kind"]];
export const DB_STEPS: Array<[Step, string]> = [
  ["kind", "Kind"], ["version", "Version"], ["resources", "Resources"],
  ["storage", "Storage & backups"], ["advanced", "Advanced"], ["review", "Review"],
];
export const SOURCE_STEPS: Array<[Step, string]> = [
  ["kind", "Kind"], ["source", "Source"], ["builder", "Builder"],
  ["networking", "Networking"], ["resources", "Resources"],
  ["variables", "Variables"], ["review", "Review"],
];
export const DOCKER_STEPS: Array<[Step, string]> = [
  ["kind", "Kind"], ["image", "Image"], ["networking", "Networking"],
  ["resources", "Resources"], ["variables", "Variables"], ["review", "Review"],
];

export function flowFor(kind: ServiceKind | null) {
  if (!kind) return KIND_STEPS;
  if (kind.group === "data") return DB_STEPS;
  if (kind.id === "docker") return DOCKER_STEPS;
  if (kind.group === "compute") return SOURCE_STEPS;
  return KIND_STEPS;
}
```

```tsx
// wizard.tsx body (step rendering — replaces the entire pyramid block)
{step === "kind"       && <StepKind />}
{step === "source"     && <StepSource />}
{step === "builder"    && <StepBuilder />}
{step === "image"      && <StepImage />}
{step === "networking" && <StepNetworking />}
{step === "resources"  && <StepResources />}
{step === "storage"    && <StepStorage />}
{step === "variables"  && <StepVariables />}
{step === "version"    && <StepVersion />}
{step === "advanced"   && <StepAdvancedDb />}
{step === "review"     && <StepReview />}
```

Step files have no prop drilling — they grab the form via `useFormContext()` and render bound fields by name.

### 7. Step in URL

`new-resource.tsx` route extends its search schema:

```ts
const zNewResourceSearch = z.object({
  kind: z.string().optional(),
  step: z.enum(STEP_IDS).optional(),
});

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/new-resource")({
  validateSearch: zNewResourceSearch,
  component: RouteComponent,
});
```

To avoid conditional hooks, the wizard splits into two thin entry points that own the step source plus a shared body that takes `step` and `goTo` as props.

```tsx
// wizard.tsx
type StepNav = { step: Step; goTo: (next: Step) => void };

export function PageResourceWizard(props: Omit<ResourceWizardProps, "layout">) {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const step = (search.step ?? "kind") as Step;
  const goTo = (next: Step) =>
    navigate({ search: (s) => ({ ...s, step: next }) });
  return <ResourceWizardBody {...props} layout="page" step={step} goTo={goTo} />;
}

export function DialogResourceWizard(props: Omit<ResourceWizardProps, "layout">) {
  const [step, setStep] = useState<Step>(props.initialStep ?? "kind");
  return (
    <ResourceWizardBody {...props} layout="dialog" step={step} goTo={setStep} />
  );
}

function ResourceWizardBody({ step, goTo, layout, ... }: ResourceWizardProps & StepNav) {
  // useAppForm, validateStep, stepper, current step body, footer
}
```

The route renders `<PageResourceWizard>`; `new-resource-dialogs.tsx` renders `<DialogResourceWizard>`. Both hooks are now unconditional within their respective component.

**Deep-link guard:** `PageResourceWizard` runs an effect on `step` / `kind` change — if the current step isn't in `flowFor(kind)`, it calls `navigate({ search: (s) => ({ ...s, step: "kind" }) })`.

## Data flow

1. Route loader has no work — `validateSearch` parses `?kind` and `?step`.
2. Wizard mounts, calls `useAppForm` with `resourceDefaults` (or `{ ...resourceDefaults, __step: search.step ?? "kind", kindId: search.kind ?? "", name: search.kind ?? "" }` when `?kind` is present).
3. User edits fields → bound `<f.TextField>` calls `field.handleChange` → form state updates → `onChange: resourceFormSchema` re-validates against the current `__step` arm only.
4. User clicks Continue → wizard sets `__step` to the next step's id, awaits `form.validate("change")`. If any errors, the user stays on the current step but the union now checks the new arm, so fields needed for the next step start surfacing errors.
5. If valid, navigate to next step (URL or local) → wizard re-renders with new step body. The URL `?step=` change is observed and pushed back into `__step` via effect.
6. On the last step, Continue sets `__step: "review"`, validates the review arm (full payload), then calls `form.handleSubmit()`. The submit handler strips `__step` before calling the create mutation.

## Error handling

- **Per-step Zod failures** surface inline on each field (multiple errors per field rendered as separate `<FieldError>`).
- **Final submit Zod failure** keeps the user on `review` — the review arm fails, no submit happens, every missing field shows its error. The Stepper marks a step as failing by trial-parsing the union with that step's id swapped in: `!resourceFormSchema.safeParse({ ...values, __step: stepId }).success`.
- **Network failure on create** (when wired) sets a wizard-level error banner via local state. The form does not lose values.

## Testing

No automated tests added in this refactor. Verification is `bunx tsc --noEmit` plus manual:

- Page flow: open `/.../new-resource`, walk a source flow end to end. Confirm refresh keeps step. Confirm browser back/forward moves between steps.
- Page flow with kind link: `?kind=postgres` lands on `kind` step with postgres preselected (current behavior).
- Dialog flow: open the overlay wizard from the project header, walk DB flow. Confirm dialog Cancel closes without touching URL.
- Validation gate: skip the `repo` field on `source`, click Continue, see inline error and the step does not advance.
- Multi-error case: clear `name` and `repo` together, Continue, confirm both errors render at once.
- Deep-link guard: paste `?step=storage` with no `?kind`, confirm wizard redirects to `?step=kind`.

## Migration order

1. Add `form-context.ts` and the bound `form-fields/*` files; no consumers yet.
2. Add `schemas/*` with the discriminated-union skeleton (each arm cumulative). Keep the old `schema.ts` in place. Confirm both compile.
3. Add `flows.ts`. Rewrite `wizard.tsx` to use `useAppForm` with `validators: { onChange: resourceFormSchema, onSubmit: resourceFormSchema }`, `useFormContext`, and bound fields. Rewrite each `steps/*.tsx` to drop props.
4. Switch `new-resource-dialogs.tsx` and the page route to the new `wizard.tsx`. Delete the old `new-resource-wizard.tsx` and `schema.ts`.
5. Add `validateSearch` for `?step=`. Wire URL navigation and the `__step` ↔ URL sync effect.
6. Add the deep-link redirect effect.

Each step compiles and the wizard remains usable between commits.
