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

### 3. `schemas/*`

Each step gets its own Zod object. `schemas/index.ts` merges them and exposes the `STEP_SCHEMAS` map.

```ts
// schemas/source.ts
import * as z from "zod";

export const sourceSchema = z.object({
  src: z.enum(["github", "gitlab"]),
  repo: z.string().min(1, "Repository is required"),
  branch: z.string().min(1, "Branch is required"),
  root: z.string(),
  autoDeploy: z.boolean(),
  previewBranches: z.boolean(),
  name: z
    .string()
    .slugify()
    .min(2, "Name must be at least 2 characters")
    .max(48, "Name must be 48 characters or fewer"),
});

// schemas/index.ts
import type { Step } from "../steps";
import { kindSchema } from "./kind";
import { sourceSchema } from "./source";
// ... others

export const resourceSchema = kindSchema
  .merge(sourceSchema).merge(builderSchema).merge(imageSchema)
  .merge(networkingSchema).merge(resourcesSchema).merge(storageSchema)
  .merge(variablesSchema).merge(versionSchema);

export type ResourceFormValues = z.infer<typeof resourceSchema>;

export const STEP_SCHEMAS: Record<Step, z.ZodTypeAny | null> = {
  kind: kindSchema,
  source: sourceSchema,
  builder: builderSchema,
  image: imageSchema,
  version: versionSchema,
  networking: networkingSchema,
  resources: resourcesSchema,
  storage: storageSchema,
  variables: variablesSchema,
  advanced: null,
  review: null,
};

export const resourceDefaults: ResourceFormValues = { /* same shape as today */ };
```

The wizard root uses only the global schema on submit:

```ts
const form = useAppForm({
  defaultValues: resourceDefaults,
  validators: { onSubmit: resourceSchema },
});
```

There is **no** `onChange` validator on the root form. Each step controls its own validation pass via the Continue gate.

### 4. The Continue gate

```ts
// wizard.tsx
async function validateStep(form: ResourceFormApi, step: Step): Promise<boolean> {
  const schema = STEP_SCHEMAS[step];
  if (!schema) return true;
  const result = schema.safeParse(form.state.values);
  if (result.success) return true;
  for (const issue of result.error.issues) {
    const name = issue.path.join(".") as DeepKeys<ResourceFormValues>;
    form.setFieldMeta(name, (m) => ({
      ...m,
      errors: [...m.errors, issue],
    }));
  }
  return false;
}

const handleContinue = async () => {
  const ok = await validateStep(form, step);
  if (!ok) return;
  if (isLast) await form.handleSubmit();
  else goTo(steps[idx + 1][0]);
};
```

Bound fields render every issue from `meta.errors`, so the user sees per-field error text the moment Continue is clicked on an invalid step.

### 5. `wizard.tsx` + `flows.ts`

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

### 6. Step in URL

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
2. Wizard mounts, calls `useAppForm` with `resourceDefaults` (or `{ ...resourceDefaults, kindId: search.kind, name: search.kind }` when `?kind` is present).
3. User edits fields → bound `<f.TextField>` calls `field.handleChange` → form state updates → no validation runs.
4. User clicks Continue → `validateStep(form, currentStep)` runs the step's Zod schema → errors are pushed onto the relevant fields via `setFieldMeta` → bound fields re-render with `errors.map(...)`.
5. If valid, navigate to next step (URL or local) → wizard re-renders with new step body.
6. On the last step, Continue calls `form.handleSubmit()` → root `onSubmit: resourceSchema` validates the full payload → success path navigates back to project.

## Error handling

- **Per-step Zod failures** surface inline on each field (multiple errors per field rendered as separate `<FieldError>`).
- **Final submit Zod failure** keeps the user on `review` and the failing fields' meta gets populated. The Stepper marks a step as failing by re-running its sub-schema against current values: `STEP_SCHEMAS[stepId]?.safeParse(form.state.values).success === false`. This avoids maintaining a separate `STEP_FIELDS` map.
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
2. Add `schemas/*`, keep the old `schema.ts` in place. Confirm both compile.
3. Add `flows.ts`. Rewrite `wizard.tsx` to use `useAppForm`, `useFormContext`, and bound fields. Rewrite each `steps/*.tsx` to drop props.
4. Switch `new-resource-dialogs.tsx` and the page route to the new `wizard.tsx`. Delete the old `new-resource-wizard.tsx` and `schema.ts`.
5. Add `validateSearch` for `?step=`. Wire URL navigation.
6. Add the deep-link redirect effect.

Each step compiles and the wizard remains usable between commits.
