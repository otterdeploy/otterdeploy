# Multi-Step Resource Wizard — TanStack Form Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the new-resource wizard so step components stop taking `AnyFieldApi` props, validation runs per-step against a `__step`-discriminated Zod union, and the active step lives in `?step=` so refresh / browser back / forward survive.

**Architecture:** Wire a typed `useAppForm` via `createFormHook` with a registry of bound field primitives. Steps grab the form via `useFormContext()` and render `<form.AppField name="...">{(f) => <f.TextField label="..." />}</form.AppField>` — no prop drilling. Validation runs against a single `z.discriminatedUnion("__step", [...])` whose arms are cumulative (each arm requires every field needed up to and including that step). Setting `__step` to the next step's id and calling `form.validate("change")` is the per-step gate. Page wizard reads/writes step from search params; dialog wizard keeps step in local state via a shared body component.

**Tech Stack:** TanStack Form v1 (`createFormHook`, `createFormHookContexts`), TanStack Router (`validateSearch`), Zod (`discriminatedUnion`), shadcn/ui primitives (`Field`, `Input`, `Select`, `Switch`, `Card`), Tailwind v4.

**Verification:** `bunx tsc --noEmit` after every task. Manual browser checks after Tasks 19, 21, 22. No automated tests added per spec.

**Spec:** `docs/superpowers/specs/2026-05-25-multi-step-form-tanstack-design.md`

---

## File Structure

**New files:**
- `apps/web/src/features/projects/components/new-resource/kind-picker.tsx` — presentational kind grid, reused by `StepKind` and `ResourceKindDialog`.
- `apps/web/src/features/projects/components/new-resource/form-context.ts` — `createFormHookContexts` + `createFormHook` with bound-field registry.
- `apps/web/src/features/projects/components/new-resource/form-fields/text-field.tsx`
- `apps/web/src/features/projects/components/new-resource/form-fields/number-field.tsx`
- `apps/web/src/features/projects/components/new-resource/form-fields/switch-field.tsx`
- `apps/web/src/features/projects/components/new-resource/form-fields/select-field.tsx`
- `apps/web/src/features/projects/components/new-resource/form-fields/ports-field.tsx`
- `apps/web/src/features/projects/components/new-resource/form-fields/variables-field.tsx`
- `apps/web/src/features/projects/components/new-resource/form-fields/linked-secrets-field.tsx`
- `apps/web/src/features/projects/components/new-resource/form-fields/submit-button.tsx`
- `apps/web/src/features/projects/components/new-resource/schemas/kind.ts`
- `apps/web/src/features/projects/components/new-resource/schemas/source.ts`
- `apps/web/src/features/projects/components/new-resource/schemas/builder.ts`
- `apps/web/src/features/projects/components/new-resource/schemas/image.ts`
- `apps/web/src/features/projects/components/new-resource/schemas/version.ts`
- `apps/web/src/features/projects/components/new-resource/schemas/networking.ts`
- `apps/web/src/features/projects/components/new-resource/schemas/resources.ts`
- `apps/web/src/features/projects/components/new-resource/schemas/storage.ts`
- `apps/web/src/features/projects/components/new-resource/schemas/variables.ts`
- `apps/web/src/features/projects/components/new-resource/schemas/advanced.ts`
- `apps/web/src/features/projects/components/new-resource/schemas/review.ts`
- `apps/web/src/features/projects/components/new-resource/schemas/index.ts` — union + types + defaults.
- `apps/web/src/features/projects/components/new-resource/flows.ts` — KIND/DB/SOURCE/DOCKER_STEPS + `flowFor`.
- `apps/web/src/features/projects/components/new-resource/wizard.tsx` — `PageResourceWizard`, `DialogResourceWizard`, shared `ResourceWizardBody`.

**Modified files (steps lose `AnyFieldApi` props; use `useFormContext`):**
- `apps/web/src/features/projects/components/new-resource/steps/index.tsx` — add `STEP_IDS` enum, keep Stepper + barrel.
- `apps/web/src/features/projects/components/new-resource/steps/kind.tsx`
- `apps/web/src/features/projects/components/new-resource/steps/source.tsx`
- `apps/web/src/features/projects/components/new-resource/steps/builder.tsx`
- `apps/web/src/features/projects/components/new-resource/steps/image.tsx`
- `apps/web/src/features/projects/components/new-resource/steps/version.tsx`
- `apps/web/src/features/projects/components/new-resource/steps/networking.tsx`
- `apps/web/src/features/projects/components/new-resource/steps/resources.tsx`
- `apps/web/src/features/projects/components/new-resource/steps/storage.tsx`
- `apps/web/src/features/projects/components/new-resource/steps/variables.tsx` — body shrinks; table UI moves to `form-fields/variables-field.tsx`.
- `apps/web/src/features/projects/components/new-resource/steps/advanced-db.tsx`
- `apps/web/src/features/projects/components/new-resource/steps/review.tsx`
- `apps/web/src/features/projects/components/new-resource/new-resource-dialogs.tsx` — import from `./wizard`; render `<DialogResourceWizard>`; `ResourceKindDialog` uses `<KindPicker>`.
- `apps/web/src/routes/_app/$orgSlug/$projectSlug/new-resource.tsx` — extend `validateSearch` with `step`; render `<PageResourceWizard>`.

**Deleted files (after cutover):**
- `apps/web/src/features/projects/components/new-resource/new-resource-wizard.tsx`
- `apps/web/src/features/projects/components/new-resource/schema.ts`

**Untouched:**
- `form-primitives.tsx` (SectionHeader, builderCardClass, etc.)
- `icons.tsx`
- `overlay-provider.tsx`

---

## Task 1: Extract `<KindPicker>` presentational component

The current `StepKind` renders both UI and form-binding. Extract the presentational layer first so both the form-context-bound step and the standalone `ResourceKindDialog` can use it.

**Files:**
- Create: `apps/web/src/features/projects/components/new-resource/kind-picker.tsx`
- (Reference: `apps/web/src/features/projects/components/new-resource/steps/kind.tsx`)

- [ ] **Step 1: Create `kind-picker.tsx` by moving the UI out of `steps/kind.tsx`**

Copy the entire body of `steps/kind.tsx` into the new file. Rename the exported component from `StepKind` to `KindPicker`. Change the props from `{ kindId, setKindId, initialTab }` to identical shape but exported types `KindPickerProps`. Keep `KindTab`, `renderLauncherKindIcon`, `iconKey` exports.

```tsx
// apps/web/src/features/projects/components/new-resource/kind-picker.tsx
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";

import {
  SERVICE_KINDS, TEMPLATES,
  type ServiceKind, type Template,
} from "@/features/projects/data/service-kinds";
import { DatabaseLogo } from "@/shared/components/brand/database-logo";
import { cn } from "@/shared/lib/utils";

import {
  SectionHeader, builderCardClass, builderCardActiveClass,
  builderIconClass, builderPopClass,
} from "./form-primitives";
import { I, type IconKey } from "./icons";

export type KindTab = "compute" | "data" | "template" | "custom";

export interface KindPickerProps {
  value: string | null;
  onChange: (id: string) => void;
  initialTab?: KindTab;
}

// ...rest of body unchanged; rename StepKind -> KindPicker; rename props kindId/setKindId -> value/onChange.
```

- [ ] **Step 2: Verify with tsc**

Run: `bunx tsc --noEmit`
Expected: PASS (the new file compiles; old `StepKind` is still present and unchanged at this point).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/projects/components/new-resource/kind-picker.tsx
git commit -m "refactor(web): extract KindPicker from StepKind for shared use"
```

---

## Task 2: Bound primitive fields (TextField, NumberField, SwitchField, SelectField)

These are thin wrappers around shadcn primitives that read their field from `useFieldContext`. They will be registered with `createFormHook` in Task 4.

**Files:**
- Create: `apps/web/src/features/projects/components/new-resource/form-fields/text-field.tsx`
- Create: `apps/web/src/features/projects/components/new-resource/form-fields/number-field.tsx`
- Create: `apps/web/src/features/projects/components/new-resource/form-fields/switch-field.tsx`
- Create: `apps/web/src/features/projects/components/new-resource/form-fields/select-field.tsx`

- [ ] **Step 1: Add a temporary `form-context.ts` stub so the field files can import `useFieldContext`**

```ts
// apps/web/src/features/projects/components/new-resource/form-context.ts
import { createFormHookContexts } from "@tanstack/react-form";
export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();
```

(The `createFormHook` call lands in Task 4 once every field component exists.)

- [ ] **Step 2: Create `text-field.tsx`**

```tsx
// apps/web/src/features/projects/components/new-resource/form-fields/text-field.tsx
import { useFieldContext } from "../form-context";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";

interface TextFieldProps {
  label: string;
  type?: "text" | "password";
  placeholder?: string;
  description?: string;
  className?: string;
}

export function TextField({ label, type = "text", placeholder, description, className }: TextFieldProps) {
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
        className={className}
      />
      {description && <div className="mt-1 text-[11px] text-muted-foreground">{description}</div>}
      {errors.map((err, i) => (
        <FieldError key={i}>{String(err?.message ?? err)}</FieldError>
      ))}
    </Field>
  );
}
```

- [ ] **Step 3: Create `number-field.tsx`**

```tsx
// apps/web/src/features/projects/components/new-resource/form-fields/number-field.tsx
import { useFieldContext } from "../form-context";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";

interface NumberFieldProps {
  label: string;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}

export function NumberField({ label, min, max, step, className }: NumberFieldProps) {
  const field = useFieldContext<number>();
  const errors = field.state.meta.errors;
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(Number(e.target.value))}
        aria-invalid={errors.length > 0}
        className={className}
      />
      {errors.map((err, i) => (
        <FieldError key={i}>{String(err?.message ?? err)}</FieldError>
      ))}
    </Field>
  );
}
```

- [ ] **Step 4: Create `switch-field.tsx`**

```tsx
// apps/web/src/features/projects/components/new-resource/form-fields/switch-field.tsx
import { useFieldContext } from "../form-context";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Switch } from "@/shared/components/ui/switch";

interface SwitchFieldProps {
  label: string;
  description?: string;
}

export function SwitchField({ label, description }: SwitchFieldProps) {
  const field = useFieldContext<boolean>();
  const errors = field.state.meta.errors;
  return (
    <Field>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <FieldLabel>{label}</FieldLabel>
          {description && <div className="text-[11px] text-muted-foreground">{description}</div>}
        </div>
        <Switch
          checked={field.state.value}
          onCheckedChange={(v) => field.handleChange(v)}
        />
      </div>
      {errors.map((err, i) => (
        <FieldError key={i}>{String(err?.message ?? err)}</FieldError>
      ))}
    </Field>
  );
}
```

- [ ] **Step 5: Create `select-field.tsx`**

```tsx
// apps/web/src/features/projects/components/new-resource/form-fields/select-field.tsx
import { useFieldContext } from "../form-context";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/shared/components/ui/select";

export interface SelectOption {
  label: string;
  value: string;
}

interface SelectFieldProps {
  label: string;
  items: SelectOption[];
  placeholder?: string;
  className?: string;
}

export function SelectField({ label, items, placeholder, className }: SelectFieldProps) {
  const field = useFieldContext<string>();
  const errors = field.state.meta.errors;
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select
        value={field.state.value}
        onValueChange={(v) => typeof v === "string" && field.handleChange(v)}
        items={items}
      >
        <SelectTrigger className={className}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {items.map((it) => (
            <SelectItem key={it.value} value={it.value}>{it.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {errors.map((err, i) => (
        <FieldError key={i}>{String(err?.message ?? err)}</FieldError>
      ))}
    </Field>
  );
}
```

- [ ] **Step 6: Verify with tsc**

Run: `bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/projects/components/new-resource/form-context.ts \
        apps/web/src/features/projects/components/new-resource/form-fields/text-field.tsx \
        apps/web/src/features/projects/components/new-resource/form-fields/number-field.tsx \
        apps/web/src/features/projects/components/new-resource/form-fields/switch-field.tsx \
        apps/web/src/features/projects/components/new-resource/form-fields/select-field.tsx
git commit -m "refactor(web): scaffold bound primitive fields for wizard form"
```

---

## Task 3: Composite fields (PortsField, VariablesField, LinkedSecretsField, SubmitButton)

These wrap the existing inline editors so step files become a single bound-field line.

**Files:**
- Create: `apps/web/src/features/projects/components/new-resource/form-fields/ports-field.tsx`
- Create: `apps/web/src/features/projects/components/new-resource/form-fields/variables-field.tsx`
- Create: `apps/web/src/features/projects/components/new-resource/form-fields/linked-secrets-field.tsx`
- Create: `apps/web/src/features/projects/components/new-resource/form-fields/submit-button.tsx`
- (Reference: existing tables in `steps/networking.tsx` lines 137-238 for ports, `steps/variables.tsx` lines 120-227 for variables, `steps/variables.tsx` lines 236-255 for linked secrets.)

- [ ] **Step 1: Create `ports-field.tsx`**

Move the ports table from `steps/networking.tsx` (the entire `<Card>` block beginning at `<SectionHeader title="Ports" ...>` and ending after the "Add port" button — lines 140-239 in the current file). Replace `portsField.handleChange(next)` with `field.handleChange(next)` after `const field = useFieldContext<Port[]>();`. Export `Port` from this file (move the interface here from `steps/networking.tsx`).

```tsx
// apps/web/src/features/projects/components/new-resource/form-fields/ports-field.tsx
import { useFieldContext } from "../form-context";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/shared/components/ui/select";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/shared/lib/utils";
import { I } from "../icons";

export interface Port {
  port: number;
  protocol: string;
  public: boolean;
  host: string;
}

const PROTOCOLS = [
  { value: "http", label: "HTTP" }, { value: "http2", label: "HTTP/2" },
  { value: "grpc", label: "gRPC" }, { value: "tcp", label: "TCP" }, { value: "udp", label: "UDP" },
];

const PORTS_GRID = "grid grid-cols-[80px_100px_1fr_70px_50px] items-center gap-2";

export function PortsField() {
  const field = useFieldContext<Port[]>();
  const ports = field.state.value;
  // ... port table body verbatim from steps/networking.tsx with portsField.handleChange -> field.handleChange
  return (
    <Card className="mt-3 gap-0 overflow-hidden rounded-md p-0">
      {/* ...verbatim table */}
    </Card>
  );
}
```

- [ ] **Step 2: Create `variables-field.tsx`**

Move the entire custom-variables `<Card>` from `steps/variables.tsx` (lines 120-227). The composite owns the table + the "Add variable / Upload .env / Paste from clipboard" toolbar. Export `Var` from this file.

```tsx
// apps/web/src/features/projects/components/new-resource/form-fields/variables-field.tsx
import { useFieldContext } from "../form-context";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/shared/components/ui/table";
import { I } from "../icons";

export interface Var {
  key: string;
  value: string;
  secret: boolean;
}

export function VariablesField() {
  const field = useFieldContext<Var[]>();
  const vars = field.state.value;
  // ...verbatim from steps/variables.tsx lines 120-227, replacing variablesField with field.
}
```

- [ ] **Step 3: Create `linked-secrets-field.tsx`**

Move the linked secret managers Card from `steps/variables.tsx` (lines 236-255). Field type is `Record<string, boolean>`.

```tsx
// apps/web/src/features/projects/components/new-resource/form-fields/linked-secrets-field.tsx
import { useFieldContext } from "../form-context";
import { Card } from "@/shared/components/ui/card";
import { Switch } from "@/shared/components/ui/switch";
import { I } from "../icons";

const SECRET_MANAGERS = [
  { id: "infisical", name: "Infisical", sub: "paperhouse · helio · /apps" },
  { id: "vault", name: "HashiCorp Vault", sub: "vault.paperhouse.dev · kv/helio" },
  { id: "aws-sm", name: "AWS Secrets Manager", sub: "us-west-2 · helio/*" },
];

export function LinkedSecretsField() {
  const field = useFieldContext<Record<string, boolean>>();
  const value = field.state.value;
  return (
    <Card className="mt-2.5 gap-0 divide-y divide-border overflow-hidden p-0">
      {SECRET_MANAGERS.map((p) => (
        <div key={p.id} className="flex items-center gap-3 px-3.5 py-3">
          <I.lock width={13} height={13} className="text-muted-foreground" />
          <div className="flex-1">
            <div className="text-[13px] font-medium">{p.name}</div>
            <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{p.sub}</div>
          </div>
          <Switch
            checked={!!value[p.id]}
            onCheckedChange={(v) => field.handleChange({ ...value, [p.id]: v })}
          />
        </div>
      ))}
    </Card>
  );
}
```

- [ ] **Step 4: Create `submit-button.tsx`**

```tsx
// apps/web/src/features/projects/components/new-resource/form-fields/submit-button.tsx
import { useFormContext } from "../form-context";
import { Button } from "@/shared/components/ui/button";

interface SubmitButtonProps {
  children: React.ReactNode;
  className?: string;
}

export function SubmitButton({ children, className }: SubmitButtonProps) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
      {([canSubmit, isSubmitting]) => (
        <Button
          type="submit"
          size="sm"
          className={className}
          disabled={!canSubmit || isSubmitting}
          onClick={() => void form.handleSubmit()}
        >
          {children}
        </Button>
      )}
    </form.Subscribe>
  );
}
```

- [ ] **Step 5: Verify with tsc**

Run: `bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/projects/components/new-resource/form-fields/ports-field.tsx \
        apps/web/src/features/projects/components/new-resource/form-fields/variables-field.tsx \
        apps/web/src/features/projects/components/new-resource/form-fields/linked-secrets-field.tsx \
        apps/web/src/features/projects/components/new-resource/form-fields/submit-button.tsx
git commit -m "refactor(web): add composite wizard form fields (ports, variables, secrets)"
```

---

## Task 4: Wire `useAppForm` with the bound-field registry

Replace the `form-context.ts` stub with the full `createFormHook` call that registers every field built in Tasks 2 and 3.

**Files:**
- Modify: `apps/web/src/features/projects/components/new-resource/form-context.ts`

- [ ] **Step 1: Replace the file body**

```ts
// apps/web/src/features/projects/components/new-resource/form-context.ts
import { createFormHook, createFormHookContexts } from "@tanstack/react-form";

import { LinkedSecretsField } from "./form-fields/linked-secrets-field";
import { NumberField } from "./form-fields/number-field";
import { PortsField } from "./form-fields/ports-field";
import { SelectField } from "./form-fields/select-field";
import { SubmitButton } from "./form-fields/submit-button";
import { SwitchField } from "./form-fields/switch-field";
import { TextField } from "./form-fields/text-field";
import { VariablesField } from "./form-fields/variables-field";

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
    NumberField,
    SwitchField,
    SelectField,
    PortsField,
    VariablesField,
    LinkedSecretsField,
  },
  formComponents: {
    SubmitButton,
  },
});
```

- [ ] **Step 2: Verify with tsc**

Run: `bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/projects/components/new-resource/form-context.ts
git commit -m "refactor(web): wire useAppForm with bound-field registry"
```

---

## Task 5: Per-step Zod arms

Each step gets its own Zod arm under `schemas/`. Each arm is cumulative — it declares every field required up to and including that step.

**Files:**
- Create: `apps/web/src/features/projects/components/new-resource/schemas/kind.ts`
- Create: `apps/web/src/features/projects/components/new-resource/schemas/source.ts`
- Create: `apps/web/src/features/projects/components/new-resource/schemas/builder.ts`
- Create: `apps/web/src/features/projects/components/new-resource/schemas/image.ts`
- Create: `apps/web/src/features/projects/components/new-resource/schemas/version.ts`
- Create: `apps/web/src/features/projects/components/new-resource/schemas/networking.ts`
- Create: `apps/web/src/features/projects/components/new-resource/schemas/resources.ts`
- Create: `apps/web/src/features/projects/components/new-resource/schemas/storage.ts`
- Create: `apps/web/src/features/projects/components/new-resource/schemas/variables.ts`
- Create: `apps/web/src/features/projects/components/new-resource/schemas/advanced.ts`
- Create: `apps/web/src/features/projects/components/new-resource/schemas/review.ts`
- (Reference: spec section 3, plus the existing `apps/web/src/features/projects/components/new-resource/schema.ts` for field lists and current rules.)

- [ ] **Step 1: Define the base fragment**

```ts
// apps/web/src/features/projects/components/new-resource/schemas/_base.ts
import * as z from "zod";

// Fields that must already be valid by the time the wizard reaches each step.
// Re-exported as a "fragment object" so step arms can spread it.
export const nameFragment = {
  name: z
    .string()
    .slugify()
    .min(2, "Name must be at least 2 characters")
    .max(48, "Name must be 48 characters or fewer"),
};

export const kindFragment = {
  kindId: z.string().min(1, "Select a resource type"),
};
```

- [ ] **Step 2: Create each per-step arm**

Use the same shape for every file: `z.object({ __step: z.literal("<id>"), ...prior fragments..., ...this step's fields })`. Full code per arm:

```ts
// schemas/kind.ts
import * as z from "zod";
import { kindFragment } from "./_base";
export const kindStepSchema = z.object({
  __step: z.literal("kind"),
  ...kindFragment,
});

// schemas/source.ts
import * as z from "zod";
import { kindFragment, nameFragment } from "./_base";
export const sourceStepSchema = z.object({
  __step: z.literal("source"),
  ...kindFragment,
  ...nameFragment,
  src: z.enum(["github", "gitlab"]),
  repo: z.string().min(1, "Repository is required"),
  branch: z.string().min(1, "Branch is required"),
  root: z.string(),
  autoDeploy: z.boolean(),
  previewBranches: z.boolean(),
});

// schemas/builder.ts
import * as z from "zod";
import { kindFragment, nameFragment } from "./_base";
export const builderStepSchema = z.object({
  __step: z.literal("builder"),
  ...kindFragment,
  ...nameFragment,
  builderId: z.string().min(1, "Select a builder"),
});

// schemas/image.ts
import * as z from "zod";
import { kindFragment, nameFragment } from "./_base";
export const imageStepSchema = z.object({
  __step: z.literal("image"),
  ...kindFragment,
  ...nameFragment,
  registry: z.string().min(1),
  image: z.string().min(1, "Image required"),
  tag: z.string().min(1, "Tag required"),
});

// schemas/version.ts
import * as z from "zod";
import { kindFragment, nameFragment } from "./_base";
export const versionStepSchema = z.object({
  __step: z.literal("version"),
  ...kindFragment,
  ...nameFragment,
  version: z.string().min(1, "Pick a version"),
});

// schemas/networking.ts
import * as z from "zod";
import { kindFragment, nameFragment } from "./_base";
const portSchema = z.object({
  port: z.number().int().min(1).max(65535),
  protocol: z.string().min(1),
  public: z.boolean(),
  host: z.string(),
});
export const networkingStepSchema = z.object({
  __step: z.literal("networking"),
  ...kindFragment,
  ...nameFragment,
  ports: z.array(portSchema),
  healthPath: z.string(),
  healthInterval: z.number().int().min(1),
});

// schemas/resources.ts
import * as z from "zod";
import { kindFragment, nameFragment } from "./_base";
export const resourcesStepSchema = z.object({
  __step: z.literal("resources"),
  ...kindFragment,
  ...nameFragment,
  presetId: z.string().min(1, "Select a size preset"),
  customCpu: z.number().min(0.1),
  customMem: z.number().min(128),
  replicas: z.number().int().min(1),
  placement: z.string().min(1),
  pinnedNodeId: z.string().nullable(),
});

// schemas/storage.ts
import * as z from "zod";
import { kindFragment, nameFragment } from "./_base";
export const storageStepSchema = z.object({
  __step: z.literal("storage"),
  ...kindFragment,
  ...nameFragment,
  storageGb: z.number().int().min(1),
  backupsEnabled: z.boolean(),
  backupRetention: z.number().int().min(1).max(365),
  pitr: z.boolean(),
  highAvailability: z.boolean(),
});

// schemas/variables.ts
import * as z from "zod";
import { kindFragment, nameFragment } from "./_base";
const varSchema = z.object({
  key: z.string(),
  value: z.string(),
  secret: z.boolean(),
});
export const variablesStepSchema = z.object({
  __step: z.literal("variables"),
  ...kindFragment,
  ...nameFragment,
  variables: z.array(varSchema),
  linkedSecrets: z.record(z.string(), z.boolean()),
});

// schemas/advanced.ts
import * as z from "zod";
import { kindFragment, nameFragment } from "./_base";
export const advancedStepSchema = z.object({
  __step: z.literal("advanced"),
  ...kindFragment,
  ...nameFragment,
});

// schemas/review.ts -- the "everything required" arm, full payload.
import * as z from "zod";
import { kindFragment, nameFragment } from "./_base";
const portSchema = z.object({
  port: z.number().int().min(1).max(65535),
  protocol: z.string().min(1),
  public: z.boolean(),
  host: z.string(),
});
const varSchema = z.object({
  key: z.string(),
  value: z.string(),
  secret: z.boolean(),
});
export const reviewStepSchema = z.object({
  __step: z.literal("review"),
  ...kindFragment,
  ...nameFragment,
  version: z.string().nullable(),
  src: z.enum(["github", "gitlab"]),
  repo: z.string(),
  branch: z.string(),
  root: z.string(),
  autoDeploy: z.boolean(),
  previewBranches: z.boolean(),
  builderId: z.string(),
  registry: z.string(),
  image: z.string(),
  tag: z.string(),
  ports: z.array(portSchema),
  healthPath: z.string(),
  healthInterval: z.number().int().min(1),
  variables: z.array(varSchema),
  linkedSecrets: z.record(z.string(), z.boolean()),
  presetId: z.string().min(1),
  customCpu: z.number().min(0.1),
  customMem: z.number().min(128),
  replicas: z.number().int().min(1),
  placement: z.string().min(1),
  pinnedNodeId: z.string().nullable(),
  storageGb: z.number().int().min(1),
  backupsEnabled: z.boolean(),
  backupRetention: z.number().int().min(1).max(365),
  pitr: z.boolean(),
  highAvailability: z.boolean(),
});
```

- [ ] **Step 3: Verify with tsc**

Run: `bunx tsc --noEmit`
Expected: PASS. (Old `schema.ts` still present; the new files have no consumers yet.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/projects/components/new-resource/schemas/
git commit -m "refactor(web): add per-step zod arms for new-resource wizard"
```

---

## Task 6: Schema index — discriminated union + types + defaults

**Files:**
- Create: `apps/web/src/features/projects/components/new-resource/schemas/index.ts`

- [ ] **Step 1: Write the file**

```ts
// apps/web/src/features/projects/components/new-resource/schemas/index.ts
import * as z from "zod";

import { advancedStepSchema } from "./advanced";
import { builderStepSchema } from "./builder";
import { imageStepSchema } from "./image";
import { kindStepSchema } from "./kind";
import { networkingStepSchema } from "./networking";
import { resourcesStepSchema } from "./resources";
import { reviewStepSchema } from "./review";
import { sourceStepSchema } from "./source";
import { storageStepSchema } from "./storage";
import { variablesStepSchema } from "./variables";
import { versionStepSchema } from "./version";

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
export type Step = ResourceFormValues["__step"];
export const STEP_IDS: readonly Step[] = [
  "kind", "source", "builder", "image", "version", "networking",
  "resources", "storage", "variables", "advanced", "review",
] as const;

// Flat shape the form actually stores. The union narrows when validating,
// but the form always holds every field.
import type { Port } from "../form-fields/ports-field";
import type { Var } from "../form-fields/variables-field";

export interface ResourceFormState {
  __step: Step;
  kindId: string;
  name: string;
  version: string | null;
  src: "github" | "gitlab";
  repo: string;
  branch: string;
  root: string;
  autoDeploy: boolean;
  previewBranches: boolean;
  builderId: string;
  registry: string;
  image: string;
  tag: string;
  ports: Port[];
  healthPath: string;
  healthInterval: number;
  variables: Var[];
  linkedSecrets: Record<string, boolean>;
  presetId: string;
  customCpu: number;
  customMem: number;
  replicas: number;
  placement: string;
  pinnedNodeId: string | null;
  storageGb: number;
  backupsEnabled: boolean;
  backupRetention: number;
  pitr: boolean;
  highAvailability: boolean;
}

export const resourceDefaults: ResourceFormState = {
  __step: "kind",
  kindId: "",
  name: "",
  version: null,
  src: "github",
  repo: "",
  branch: "main",
  root: "",
  autoDeploy: true,
  previewBranches: true,
  builderId: "railpack",
  registry: "docker",
  image: "ghcr.io/paperhouse/notify",
  tag: "latest",
  ports: [{ port: 3000, protocol: "http", public: true, host: "" }],
  healthPath: "/healthz",
  healthInterval: 10,
  variables: [],
  linkedSecrets: {},
  presetId: "small",
  customCpu: 0.5,
  customMem: 512,
  replicas: 1,
  placement: "any",
  pinnedNodeId: null,
  storageGb: 20,
  backupsEnabled: false,
  backupRetention: 7,
  pitr: false,
  highAvailability: false,
};
```

- [ ] **Step 2: Verify with tsc**

Run: `bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/projects/components/new-resource/schemas/index.ts
git commit -m "refactor(web): add resourceFormSchema discriminated union + defaults"
```

---

## Task 7: `flows.ts` — step lists + `flowFor(kind)`

Replace the inline `DB_STEPS` / `SOURCE_STEPS` / `DOCKER_STEPS` arrays in `new-resource-wizard.tsx` with a dedicated module.

**Files:**
- Create: `apps/web/src/features/projects/components/new-resource/flows.ts`

- [ ] **Step 1: Write the file**

```ts
// apps/web/src/features/projects/components/new-resource/flows.ts
import type { ServiceKind } from "@/features/projects/data/service-kinds";

import type { Step } from "./schemas";

export type StepEntry = [Step, string];

export const KIND_STEPS: StepEntry[] = [["kind", "Kind"]];

export const DB_STEPS: StepEntry[] = [
  ["kind", "Kind"],
  ["version", "Version"],
  ["resources", "Resources"],
  ["storage", "Storage & backups"],
  ["advanced", "Advanced"],
  ["review", "Review"],
];

export const SOURCE_STEPS: StepEntry[] = [
  ["kind", "Kind"],
  ["source", "Source"],
  ["builder", "Builder"],
  ["networking", "Networking"],
  ["resources", "Resources"],
  ["variables", "Variables"],
  ["review", "Review"],
];

export const DOCKER_STEPS: StepEntry[] = [
  ["kind", "Kind"],
  ["image", "Image"],
  ["networking", "Networking"],
  ["resources", "Resources"],
  ["variables", "Variables"],
  ["review", "Review"],
];

export function flowFor(kind: ServiceKind | null): StepEntry[] {
  if (!kind) return KIND_STEPS;
  if (kind.group === "data") return DB_STEPS;
  if (kind.id === "docker") return DOCKER_STEPS;
  if (kind.group === "compute") return SOURCE_STEPS;
  return KIND_STEPS;
}
```

- [ ] **Step 2: Verify with tsc**

Run: `bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/projects/components/new-resource/flows.ts
git commit -m "refactor(web): extract wizard flow definitions into flows.ts"
```

---

## Task 8: Rewrite `steps/index.tsx` — expose `Step` from schemas, keep Stepper

The Stepper itself doesn't change behavior, but its `Step` type now comes from `schemas/index.ts` (Task 6). The barrel exports stay so callers can continue to import step components from `./steps`.

**Files:**
- Modify: `apps/web/src/features/projects/components/new-resource/steps/index.tsx`

- [ ] **Step 1: Replace the `Step` type alias with a re-export and add error-marker support**

Find the union literal `export type Step = "kind" | "source" | ...` (lines 6-18) and replace with a re-export. Extend `Stepper` props to optionally accept `failingSteps: Set<Step>` so it can mark steps that fail their sub-schema.

```tsx
// apps/web/src/features/projects/components/new-resource/steps/index.tsx
import { Fragment } from "react";

import { cn } from "@/shared/lib/utils";
import { I } from "../icons";

export type { Step } from "../schemas";
import type { Step } from "../schemas";

interface StepperProps {
  steps: Array<[Step, string]>;
  idx: number;
  setStep: (s: Step) => void;
  failingSteps?: Set<Step>;
}

export function Stepper({ steps, idx, setStep, failingSteps }: StepperProps) {
  return (
    <div className="flex items-center overflow-x-auto border-b bg-muted px-[22px] py-3.5">
      {steps.map(([id, lab], i) => {
        const isCurrent = i === idx;
        const isPast = i < idx;
        const isFuture = i > idx;
        const failing = failingSteps?.has(id) === true;
        return (
          <Fragment key={id}>
            <button
              type="button"
              onClick={() => !isFuture && setStep(id)}
              disabled={isFuture}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1 text-xs transition-colors",
                isCurrent && "font-medium text-foreground",
                isPast && "cursor-pointer text-muted-foreground hover:text-foreground",
                isFuture && "cursor-default text-muted-foreground opacity-50",
                failing && "text-destructive",
              )}
            >
              <span
                className={cn(
                  "grid size-[18px] place-items-center rounded-full font-mono text-[10px] font-semibold",
                  failing
                    ? "bg-destructive text-destructive-foreground"
                    : isCurrent || isPast
                      ? "bg-foreground text-background"
                      : "border border-border bg-muted text-muted-foreground",
                )}
              >
                {isPast && !failing ? <I.check width={10} height={10} /> : i + 1}
              </span>
              <span>{lab}</span>
            </button>
            {i < steps.length - 1 && <div className="mx-1.5 h-px min-w-4 flex-1 bg-border" />}
          </Fragment>
        );
      })}
    </div>
  );
}

export * from "./kind";
export * from "./source";
export * from "./builder";
export * from "./image";
export * from "./version";
export * from "./networking";
export * from "./resources";
export * from "./storage";
export * from "./variables";
export * from "./review";
export * from "./advanced-db";
```

- [ ] **Step 2: Verify with tsc**

Run: `bunx tsc --noEmit`
Expected: PASS (the `Step` union from `schemas/index.ts` matches the previous one exactly).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/projects/components/new-resource/steps/index.tsx
git commit -m "refactor(web): point Stepper at schema Step type, add failing-step marker"
```

---

## Task 9: Rewrite `steps/kind.tsx` to use form context + `<KindPicker>`

**Files:**
- Modify: `apps/web/src/features/projects/components/new-resource/steps/kind.tsx`

- [ ] **Step 1: Replace the file body**

```tsx
// apps/web/src/features/projects/components/new-resource/steps/kind.tsx
import { useStore } from "@tanstack/react-form";

import { SERVICE_KINDS } from "@/features/projects/data/service-kinds";

import { useFormContext } from "../form-context";
import { KindPicker, type KindTab } from "../kind-picker";
import { SectionHeader } from "../form-primitives";

export type { KindTab };

interface StepKindProps {
  initialTab?: KindTab;
}

export function StepKind({ initialTab }: StepKindProps) {
  const form = useFormContext();
  const kindId = useStore(form.store, (s) => s.values.kindId as string | "");

  return (
    <>
      <SectionHeader
        title="What do you want to deploy?"
        sub="Pick a service type to get a tailored creation flow"
      />
      <KindPicker
        value={kindId || null}
        onChange={(id) => {
          form.setFieldValue("kindId", id);
          const k = SERVICE_KINDS.find((x) => x.id === id);
          if (k) {
            form.setFieldValue("name", k.id);
            form.setFieldValue("version", k.versions && k.versions.length > 0 ? k.versions[0] : null);
          }
        }}
        initialTab={initialTab}
      />
    </>
  );
}
```

- [ ] **Step 2: Verify with tsc**

Run: `bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/projects/components/new-resource/steps/kind.tsx
git commit -m "refactor(web): rewrite StepKind around form context + KindPicker"
```

---

## Task 10: Rewrite `steps/source.tsx`

**Files:**
- Modify: `apps/web/src/features/projects/components/new-resource/steps/source.tsx`

- [ ] **Step 1: Replace the file body**

Drop the `SourceProps` interface and the seven `AnyFieldApi` props. Read `src` via `useStore` to drive the conditional `src === "github"` panels. Render named bound fields for the configuration block. Keep the visual cards (GitHub/GitLab/Gitea/PublicGit/CLI buttons) but switch their `onClick` to `form.setFieldValue("src", id)`.

```tsx
// apps/web/src/features/projects/components/new-resource/steps/source.tsx
import { useStore } from "@tanstack/react-form";
import { HugeiconsIcon } from "@hugeicons/react";
import { GitBranchIcon, Search01Icon, Tick02Icon } from "@hugeicons/core-free-icons";

import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent } from "@/shared/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/shared/components/ui/input-group";
import { cn } from "@/shared/lib/utils";

import { useFormContext } from "../form-context";
import { builderCardActiveClass, builderCardClass, builderIconClass, SectionHeader } from "../form-primitives";
import { I } from "../icons";

// (sources / recent / sourceBrandSearch / iconKey arrays + helpers stay verbatim
//  from the current file — copy them across unchanged.)

export function StepSource() {
  const form = useFormContext();
  const src = useStore(form.store, (s) => s.values.src as string);
  const repo = useStore(form.store, (s) => s.values.repo as string);
  const branch = useStore(form.store, (s) => s.values.branch as string);

  return (
    <>
      <SectionHeader title="Where does the code live?" />
      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {sources.map((s) => {
          const Ic = I[iconKey(s.icon)];
          const svgl = sourceBrandSearch(s.id);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => form.setFieldValue("src", s.id)}
              className={cn(builderCardClass, src === s.id && builderCardActiveClass)}
            >
              {/* card body verbatim */}
            </button>
          );
        })}
      </div>

      {src === "github" && (
        <>
          <div className="mt-5">
            <SectionHeader title="Repository" />
          </div>
          <Card className="mt-2.5 gap-0 overflow-hidden p-0">
            <InputGroup className="rounded-none border-x-0 border-t-0 border-b shadow-none">
              <InputGroupAddon>
                <HugeiconsIcon icon={Search01Icon} strokeWidth={2} className="size-4 text-muted-foreground" />
              </InputGroupAddon>
              <InputGroupInput
                className="font-mono"
                placeholder="search repositories…"
                defaultValue={repo}
                onChange={(e) => form.setFieldValue("repo", e.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <Badge variant="outline" className="font-normal">paperhouse · github app</Badge>
              </InputGroupAddon>
            </InputGroup>
            <div className="max-h-56 overflow-y-auto">
              {recent.map((r) => {
                const isSelected = repo === r.repo;
                return (
                  <button
                    key={r.repo}
                    type="button"
                    onClick={() => form.setFieldValue("repo", r.repo)}
                    aria-pressed={isSelected}
                    className={`flex w-full items-center gap-3 border-b border-border/60 px-3 py-2 text-left text-foreground last:border-b-0 transition-colors hover:bg-accent/40 ${isSelected ? "bg-accent" : ""}`}
                  >
                    <HugeiconsIcon icon={GitBranchIcon} strokeWidth={2} className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 font-mono text-[13px]">{r.repo}</span>
                    <Badge variant="secondary" className="font-normal">{r.lang}</Badge>
                    <span className="font-mono text-[11px] text-muted-foreground">★ {r.stars} · {r.updated}</span>
                    {isSelected && <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="size-3.5 text-success" />}
                  </button>
                );
              })}
            </div>
          </Card>

          <div className="mt-4.5">
            <SectionHeader title="Configuration" />
          </div>
          <Card className="mt-2.5 rounded-md">
            <CardContent className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2.5">
                <form.AppField name="branch">
                  {(f) => (
                    <f.SelectField
                      label="Branch"
                      items={[
                        { label: "main", value: "main" },
                        { label: "develop", value: "develop" },
                        { label: "staging", value: "staging" },
                      ]}
                      className="w-full font-mono"
                    />
                  )}
                </form.AppField>
                <form.AppField name="root">
                  {(f) => <f.TextField label="Root directory" className="font-mono" />}
                </form.AppField>
              </div>
              <form.AppField name="name">
                {(f) => (
                  <f.TextField
                    label="Service name"
                    className="font-mono"
                    description={`Used in DNS — ${form.state.values.name}.helio.internal`}
                  />
                )}
              </form.AppField>
              <form.AppField name="autoDeploy">
                {(f) => (
                  <f.SwitchField
                    label="Auto-deploy on push"
                    description={`Trigger a deploy whenever ${branch} updates`}
                  />
                )}
              </form.AppField>
              <form.AppField name="previewBranches">
                {(f) => (
                  <f.SwitchField
                    label="Preview deploys for pull requests"
                    description="Spin up a temporary environment for every PR"
                  />
                )}
              </form.AppField>
            </CardContent>
          </Card>
        </>
      )}

      {/* pubgit / cli panels left unchanged in structure -- they don't write to the form today
          and can stay as visual stubs. */}
    </>
  );
}
```

- [ ] **Step 2: Verify with tsc**

Run: `bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/projects/components/new-resource/steps/source.tsx
git commit -m "refactor(web): drop AnyFieldApi props from StepSource"
```

---

## Task 11: Rewrite `steps/builder.tsx`

**Files:**
- Modify: `apps/web/src/features/projects/components/new-resource/steps/builder.tsx`

- [ ] **Step 1: Replace the file body**

Drop `builderIdField`/`nameField` props. Read `builderId` from form via `useStore` to drive the active-card highlight. Render the builder picker grid (keep current visual), and a bound `<f.TextField name="name">` for service name.

```tsx
// apps/web/src/features/projects/components/new-resource/steps/builder.tsx
import { useStore } from "@tanstack/react-form";

import { Card, CardContent } from "@/shared/components/ui/card";
import { cn } from "@/shared/lib/utils";

import { useFormContext } from "../form-context";
import { builderCardActiveClass, builderCardClass, builderIconClass, SectionHeader } from "../form-primitives";
import { I } from "../icons";

// BUILDERS constant + iconKey helper stay verbatim from current file.

export function StepBuilder() {
  const form = useFormContext();
  const builderId = useStore(form.store, (s) => s.values.builderId as string);

  return (
    <>
      <SectionHeader title="How should we build it?" />
      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {BUILDERS.map((b) => {
          const Ic = I[iconKey(b.icon)];
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => form.setFieldValue("builderId", b.id)}
              className={cn(builderCardClass, builderId === b.id && builderCardActiveClass)}
            >
              <div className="flex items-center gap-2">
                <div className={builderIconClass}><Ic width={13} height={13} /></div>
                <span className="text-[13px] font-semibold">{b.name}</span>
              </div>
              <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{b.sub}</div>
            </button>
          );
        })}
      </div>

      <div className="mt-4.5">
        <SectionHeader title="Service" />
      </div>
      <Card className="mt-2.5 rounded-md">
        <CardContent>
          <form.AppField name="name">
            {(f) => <f.TextField label="Service name" className="font-mono" />}
          </form.AppField>
        </CardContent>
      </Card>
    </>
  );
}
```

- [ ] **Step 2: tsc**

Run: `bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/projects/components/new-resource/steps/builder.tsx
git commit -m "refactor(web): drop AnyFieldApi props from StepBuilder"
```

---

## Task 12: Rewrite `steps/image.tsx`

**Files:**
- Modify: `apps/web/src/features/projects/components/new-resource/steps/image.tsx`

- [ ] **Step 1: Replace the file body**

Drop the four `AnyFieldApi` props. Render bound `<f.TextField>` for `registry`, `image`, `tag`, and `name`.

```tsx
// apps/web/src/features/projects/components/new-resource/steps/image.tsx
import { Card, CardContent } from "@/shared/components/ui/card";

import { useFormContext } from "../form-context";
import { SectionHeader } from "../form-primitives";

export function StepImage() {
  const form = useFormContext();
  return (
    <>
      <SectionHeader title="Image" sub="Pull from any OCI registry" />
      <Card className="mt-3 rounded-md">
        <CardContent className="flex flex-col gap-3">
          <form.AppField name="registry">
            {(f) => <f.TextField label="Registry" className="font-mono" placeholder="docker / ghcr" />}
          </form.AppField>
          <form.AppField name="image">
            {(f) => <f.TextField label="Image" className="font-mono" placeholder="ghcr.io/owner/repo" />}
          </form.AppField>
          <form.AppField name="tag">
            {(f) => <f.TextField label="Tag" className="font-mono" placeholder="latest" />}
          </form.AppField>
          <form.AppField name="name">
            {(f) => <f.TextField label="Service name" className="font-mono" />}
          </form.AppField>
        </CardContent>
      </Card>
    </>
  );
}
```

- [ ] **Step 2: tsc**

Run: `bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/projects/components/new-resource/steps/image.tsx
git commit -m "refactor(web): drop AnyFieldApi props from StepImage"
```

---

## Task 13: Rewrite `steps/version.tsx`

**Files:**
- Modify: `apps/web/src/features/projects/components/new-resource/steps/version.tsx`

- [ ] **Step 1: Replace the file body**

```tsx
// apps/web/src/features/projects/components/new-resource/steps/version.tsx
import { useStore } from "@tanstack/react-form";

import type { ServiceKind } from "@/features/projects/data/service-kinds";
import { Card, CardContent } from "@/shared/components/ui/card";
import { cn } from "@/shared/lib/utils";

import { useFormContext } from "../form-context";
import { builderCardActiveClass, builderCardClass, SectionHeader } from "../form-primitives";

interface StepVersionProps {
  kind: ServiceKind;
}

export function StepVersion({ kind }: StepVersionProps) {
  const form = useFormContext();
  const version = useStore(form.store, (s) => s.values.version as string | null);
  const versions = kind.versions ?? [];

  return (
    <>
      <SectionHeader title={`${kind.name} version`} sub="Pick the major version to provision" />
      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {versions.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => form.setFieldValue("version", v)}
            className={cn(builderCardClass, version === v && builderCardActiveClass, "text-center")}
          >
            <div className="font-mono text-[15px] font-semibold">{v}</div>
          </button>
        ))}
      </div>

      <div className="mt-4.5">
        <SectionHeader title="Service" />
      </div>
      <Card className="mt-2.5 rounded-md">
        <CardContent>
          <form.AppField name="name">
            {(f) => <f.TextField label="Service name" className="font-mono" />}
          </form.AppField>
        </CardContent>
      </Card>
    </>
  );
}
```

- [ ] **Step 2: tsc + commit**

Run: `bunx tsc --noEmit`
Expected: PASS.

```bash
git add apps/web/src/features/projects/components/new-resource/steps/version.tsx
git commit -m "refactor(web): drop AnyFieldApi props from StepVersion"
```

---

## Task 14: Rewrite `steps/networking.tsx`

**Files:**
- Modify: `apps/web/src/features/projects/components/new-resource/steps/networking.tsx`

- [ ] **Step 1: Replace the file body**

Drop `portsField` / `healthPathField` / `healthIntervalField` props. The cron / worker conditional branches stay as static-display stubs (they don't write to the form today). The ports table is now `<form.AppField name="ports">{(f) => <f.PortsField />}</form.AppField>`. Health-path / health-interval become bound `<f.TextField>` / `<f.NumberField>`. Remove the inline `Port` interface (it now lives in `form-fields/ports-field.tsx`).

```tsx
// apps/web/src/features/projects/components/new-resource/steps/networking.tsx
import type { ServiceKind } from "@/features/projects/data/service-kinds";
import { Card, CardContent } from "@/shared/components/ui/card";

import { useFormContext } from "../form-context";
import { Field, SectionHeader, SettingRow } from "../form-primitives";
import { Input } from "@/shared/components/ui/input";

interface StepNetworkingProps {
  kind: ServiceKind | null;
}

export function StepNetworking({ kind }: StepNetworkingProps) {
  const form = useFormContext();
  const isWorker = kind?.id === "worker";
  const isCron = kind?.id === "cron";
  const isStatic = kind?.id === "static";

  if (isCron) {
    /* cron stub — verbatim from current file (lines 60-108) */
  }
  if (isWorker) {
    /* worker stub — verbatim from current file (lines 110-135) */
  }

  return (
    <>
      <SectionHeader title="Ports" sub="Which container ports should be exposed?" />
      <form.AppField name="ports">
        {(f) => <f.PortsField />}
      </form.AppField>

      {!isStatic && (
        <>
          <div className="mt-4.5">
            <SectionHeader title="Health check" sub="How does Otterstack know your service is ready to serve traffic?" />
          </div>
          <Card className="mt-2.5 rounded-md">
            <CardContent className="flex flex-col gap-2.5">
              <div className="grid grid-cols-[2fr_1fr_1fr] gap-2.5">
                <form.AppField name="healthPath">
                  {(f) => <f.TextField label="Path" className="font-mono" />}
                </form.AppField>
                <form.AppField name="healthInterval">
                  {(f) => <f.NumberField label="Interval (s)" min={1} className="font-mono" />}
                </form.AppField>
                <Field label="Timeout">
                  <Input className="font-mono" defaultValue="3s" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Successes before ready"><Input className="font-mono" type="number" defaultValue={2} /></Field>
                <Field label="Failures before unhealthy"><Input className="font-mono" type="number" defaultValue={3} /></Field>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <div className="mt-4.5">
        <SectionHeader title="Edge proxy" />
      </div>
      {/* edge-proxy SettingRow card — verbatim from current file */}
    </>
  );
}
```

- [ ] **Step 2: tsc + commit**

```bash
bunx tsc --noEmit
git add apps/web/src/features/projects/components/new-resource/steps/networking.tsx
git commit -m "refactor(web): drop AnyFieldApi props from StepNetworking"
```

---

## Task 15: Rewrite `steps/resources.tsx`

**Files:**
- Modify: `apps/web/src/features/projects/components/new-resource/steps/resources.tsx`

- [ ] **Step 1: Replace the file body**

Drop the six props. Preset-card grid reads `presetId` via `useStore` and writes via `form.setFieldValue`. `customCpu` / `customMem` / `replicas` become bound `<f.NumberField>`. `placement` becomes `<f.SelectField>`. `pinnedNodeId` becomes `<f.SelectField>` (with a synthetic options list).

```tsx
// apps/web/src/features/projects/components/new-resource/steps/resources.tsx
import { useStore } from "@tanstack/react-form";

import { RESOURCE_PRESETS } from "@/features/projects/data/service-kinds";
import { Card, CardContent } from "@/shared/components/ui/card";
import { cn } from "@/shared/lib/utils";

import { useFormContext } from "../form-context";
import { builderCardActiveClass, builderCardClass, SectionHeader } from "../form-primitives";

interface StepResourcesProps {
  isDb: boolean;
}

export function StepResources({ isDb }: StepResourcesProps) {
  const form = useFormContext();
  const presetId = useStore(form.store, (s) => s.values.presetId as string);
  const placement = useStore(form.store, (s) => s.values.placement as string);

  return (
    <>
      <SectionHeader title="Size" sub={isDb ? "How much room does the database need?" : "How much CPU / memory per replica?"} />
      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {RESOURCE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => form.setFieldValue("presetId", p.id)}
            className={cn(builderCardClass, presetId === p.id && builderCardActiveClass)}
          >
            <div className="text-[13px] font-semibold">{p.name}</div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">{p.cpu} vCPU · {p.mem >= 1024 ? p.mem / 1024 + " GB" : p.mem + " MB"}</div>
          </button>
        ))}
      </div>

      {presetId === "custom" && (
        <Card className="mt-4 rounded-md">
          <CardContent className="grid grid-cols-2 gap-3">
            <form.AppField name="customCpu">
              {(f) => <f.NumberField label="vCPU" min={0.1} step={0.1} className="font-mono" />}
            </form.AppField>
            <form.AppField name="customMem">
              {(f) => <f.NumberField label="Memory (MB)" min={128} step={64} className="font-mono" />}
            </form.AppField>
          </CardContent>
        </Card>
      )}

      {!isDb && (
        <>
          <div className="mt-4.5">
            <SectionHeader title="Replicas" />
          </div>
          <Card className="mt-2.5 rounded-md">
            <CardContent>
              <form.AppField name="replicas">
                {(f) => <f.NumberField label="Replica count" min={1} className="font-mono" />}
              </form.AppField>
            </CardContent>
          </Card>
        </>
      )}

      <div className="mt-4.5">
        <SectionHeader title="Placement" />
      </div>
      <Card className="mt-2.5 rounded-md">
        <CardContent className="flex flex-col gap-3">
          <form.AppField name="placement">
            {(f) => (
              <f.SelectField
                label="Placement strategy"
                items={[
                  { label: "Any node", value: "any" },
                  { label: "Specific node (pinned)", value: "pinned" },
                ]}
              />
            )}
          </form.AppField>
          {placement === "pinned" && (
            <form.AppField name="pinnedNodeId">
              {(f) => (
                <f.SelectField
                  label="Pinned node"
                  items={[
                    { label: "node-1.helio.internal", value: "node-1" },
                    { label: "node-2.helio.internal", value: "node-2" },
                  ]}
                />
              )}
            </form.AppField>
          )}
        </CardContent>
      </Card>
    </>
  );
}
```

- [ ] **Step 2: tsc + commit**

```bash
bunx tsc --noEmit
git add apps/web/src/features/projects/components/new-resource/steps/resources.tsx
git commit -m "refactor(web): drop AnyFieldApi props from StepResources"
```

---

## Task 16: Rewrite `steps/storage.tsx`

**Files:**
- Modify: `apps/web/src/features/projects/components/new-resource/steps/storage.tsx`

- [ ] **Step 1: Replace the file body**

Drop the five props. Bound `<f.NumberField>` for `storageGb` and `backupRetention`; bound `<f.SwitchField>` for `backupsEnabled`, `pitr`, `highAvailability`.

```tsx
// apps/web/src/features/projects/components/new-resource/steps/storage.tsx
import type { ServiceKind } from "@/features/projects/data/service-kinds";
import { Card, CardContent } from "@/shared/components/ui/card";

import { useFormContext } from "../form-context";
import { SectionHeader } from "../form-primitives";

interface StepStorageProps {
  kind: ServiceKind;
}

export function StepStorage({ kind }: StepStorageProps) {
  const form = useFormContext();
  return (
    <>
      <SectionHeader title="Storage" sub={`How much disk does ${kind.name} need?`} />
      <Card className="mt-3 rounded-md">
        <CardContent className="flex flex-col gap-3">
          <form.AppField name="storageGb">
            {(f) => <f.NumberField label="Volume size (GB)" min={1} className="font-mono" />}
          </form.AppField>
          <form.AppField name="backupsEnabled">
            {(f) => <f.SwitchField label="Daily backups" description="Snapshot to object storage every 24h" />}
          </form.AppField>
          <form.AppField name="backupRetention">
            {(f) => <f.NumberField label="Backup retention (days)" min={1} max={365} className="font-mono" />}
          </form.AppField>
          <form.AppField name="pitr">
            {(f) => <f.SwitchField label="Point-in-time recovery" description="Continuous WAL archiving" />}
          </form.AppField>
          <form.AppField name="highAvailability">
            {(f) => <f.SwitchField label="High availability" description="Replicate to a secondary node" />}
          </form.AppField>
        </CardContent>
      </Card>
    </>
  );
}
```

- [ ] **Step 2: tsc + commit**

```bash
bunx tsc --noEmit
git add apps/web/src/features/projects/components/new-resource/steps/storage.tsx
git commit -m "refactor(web): drop AnyFieldApi props from StepStorage"
```

---

## Task 17: Rewrite `steps/variables.tsx`

**Files:**
- Modify: `apps/web/src/features/projects/components/new-resource/steps/variables.tsx`

- [ ] **Step 1: Replace the file body**

Drop the `variablesField` / `linkedSecretsField` props. The big custom-variables table moved to `form-fields/variables-field.tsx` in Task 3; the linked secret managers card moved to `form-fields/linked-secrets-field.tsx`. The step body shrinks to: section header, auto-injected suggestions table (kept inline since it's display-only), bound `<f.VariablesField>`, bound `<f.LinkedSecretsField>`.

```tsx
// apps/web/src/features/projects/components/new-resource/steps/variables.tsx
import type { ServiceKind } from "@/features/projects/data/service-kinds";
import { Badge } from "@/shared/components/ui/badge";
import { Card } from "@/shared/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/shared/components/ui/table";

import { useFormContext } from "../form-context";
import { SectionHeader } from "../form-primitives";
import { I } from "../icons";

interface StepVariablesProps {
  kind: ServiceKind | null;
}

export function StepVariables({ kind }: StepVariablesProps) {
  const form = useFormContext();

  const suggested =
    !kind || kind.group !== "data"
      ? [
          { k: "NODE_ENV", v: "production", source: "auto" as const },
          { k: "PORT", v: "3000", source: "auto" as const },
          { k: "DATABASE_URL", v: "postgres://helio:•••@postgres.helio.internal:5432/helio", source: "linked" as const, from: "postgres" },
          { k: "REDIS_URL", v: "redis://cache.helio.internal:6379", source: "linked" as const, from: "cache" },
        ]
      : [];

  return (
    <>
      <SectionHeader title="Environment variables" sub="Define values to inject at runtime" />

      {suggested.length > 0 && (
        <Card className="mt-3 gap-0 overflow-hidden p-0">
          {/* auto-injected display table — verbatim from current file, lines 75-110 */}
        </Card>
      )}

      <div className="mt-5">
        <SectionHeader title="Custom variables" sub="Add key/value pairs — toggle the lock to mark a value as secret" />
      </div>
      <form.AppField name="variables">
        {(f) => <f.VariablesField />}
      </form.AppField>

      <div className="mt-5">
        <SectionHeader title="Linked secret managers" sub="Pull secrets from external managers — they sync continuously" />
      </div>
      <form.AppField name="linkedSecrets">
        {(f) => <f.LinkedSecretsField />}
      </form.AppField>
    </>
  );
}
```

- [ ] **Step 2: tsc + commit**

```bash
bunx tsc --noEmit
git add apps/web/src/features/projects/components/new-resource/steps/variables.tsx
git commit -m "refactor(web): collapse StepVariables to bound fields"
```

---

## Task 18: Rewrite `steps/advanced-db.tsx`

**Files:**
- Modify: `apps/web/src/features/projects/components/new-resource/steps/advanced-db.tsx`

- [ ] **Step 1: Replace the file body**

The current StepAdvancedDb takes a `kind` prop only and renders display-only `SettingRow` cards (no form writes). Keep behavior unchanged but drop any dead imports. The step has nothing form-bound right now — leave it as a static stub.

(If the current file has no AnyFieldApi imports, this task may be a no-op except for confirming the file still typechecks against the new `Step` union. Run tsc and commit if no changes are needed; otherwise edit accordingly.)

- [ ] **Step 2: tsc + commit**

```bash
bunx tsc --noEmit
git add apps/web/src/features/projects/components/new-resource/steps/advanced-db.tsx
git diff --cached --quiet || git commit -m "refactor(web): align StepAdvancedDb with form-context wizard"
```

---

## Task 19: Rewrite `steps/review.tsx`

**Files:**
- Modify: `apps/web/src/features/projects/components/new-resource/steps/review.tsx`

- [ ] **Step 1: Replace the file body**

Drop the `values` / `kind` props (kind is still passed because the visual depends on the picked kind). Render via `form.Subscribe`, narrowing inside.

```tsx
// apps/web/src/features/projects/components/new-resource/steps/review.tsx
import { RESOURCE_PRESETS, type ServiceKind } from "@/features/projects/data/service-kinds";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";

import { useFormContext } from "../form-context";
import { SectionHeader } from "../form-primitives";
import { I } from "../icons";

interface StepReviewProps {
  kind: ServiceKind;
}

export function StepReview({ kind }: StepReviewProps) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(s) => s.values}>
      {(values) => {
        const { name, version, presetId, customCpu, customMem, replicas, storageGb, backupsEnabled } = values;
        const preset = RESOURCE_PRESETS.find((p) => p.id === presetId);
        const cpu = preset?.cpu ?? customCpu;
        const mem = preset?.mem ?? customMem;
        const isDb = kind.group === "data";

        const generateCompose = () => { /* verbatim from current file */ };
        const compose = generateCompose();

        return (
          <>
            <SectionHeader title="Review" sub="Confirm and deploy — you can change all of this later" />
            {/* body verbatim from current file (lines 68-134) using `values`, `cpu`, `mem`, `compose`. */}
          </>
        );
      }}
    </form.Subscribe>
  );
}

function ReviewRow({ label, value, last }: { label: string; value?: string; last?: boolean }) { /* verbatim */ }
function SectionLabel({ children }: { children: React.ReactNode }) { /* verbatim */ }
```

- [ ] **Step 2: tsc + commit**

```bash
bunx tsc --noEmit
git add apps/web/src/features/projects/components/new-resource/steps/review.tsx
git commit -m "refactor(web): drop values prop from StepReview, subscribe internally"
```

---

## Task 20: Build the new `wizard.tsx` with Page + Dialog variants

**Files:**
- Create: `apps/web/src/features/projects/components/new-resource/wizard.tsx`
- (Reference: spec sections 5 and 7)

- [ ] **Step 1: Write the file**

```tsx
// apps/web/src/features/projects/components/new-resource/wizard.tsx
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
  StepAdvancedDb, StepBuilder, StepImage, StepKind, StepNetworking,
  StepResources, StepReview, StepSource, StepStorage, StepVariables, StepVersion,
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
  const step = (search.step ?? "kind") as Step;
  const goTo = (next: Step) =>
    navigate({
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
  orgSlug, projectSlug, projectName, initialKind = null,
  onComplete, onCancel, layout, step, goTo,
}: BodyProps) {
  const form = useAppForm({
    defaultValues: initialKind
      ? { ...resourceDefaults, __step: step, kindId: initialKind, name: initialKind }
      : { ...resourceDefaults, __step: step },
    validators: { onChange: resourceFormSchema, onSubmit: resourceFormSchema },
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
  const failingSteps = useMemo(() => {
    const out = new Set<Step>();
    for (const [id] of steps) {
      const probe = { ...form.state.values, __step: id };
      if (!resourceFormSchema.safeParse(probe).success) out.add(id);
    }
    return out;
  }, [form.state.values, steps]);

  const handleContinue = async () => {
    const nextStep: Step = isLast ? "review" : steps[idx + 1][0];
    form.setFieldValue("__step", nextStep);
    const result = await form.validate("change");
    if (result.errors.length > 0) return;
    if (isLast) await form.handleSubmit();
    else goTo(nextStep);
  };
  const goPrev = () => { if (idx > 0) goTo(steps[idx - 1][0]); };
  const showChrome = layout === "page";

  return (
    <form.AppForm>
      <div className={`flex h-full flex-col text-foreground ${layout === "page" ? "bg-background" : "bg-transparent"}`}>
        {showChrome && (
          <div className="flex shrink-0 items-center gap-3 border-b bg-card px-5 py-3">
            <Button
              variant="ghost" size="sm"
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
            {step === "kind"       && <StepKind />}
            {step === "source"     && kind && isSourceBased && <StepSource />}
            {step === "builder"    && kind && isSourceBased && <StepBuilder />}
            {step === "image"      && kind && isDocker       && <StepImage />}
            {step === "networking" && kind && (isSourceBased || isDocker) && <StepNetworking kind={kind} />}
            {step === "resources"  && kind && <StepResources isDb={isDb} />}
            {step === "variables"  && kind && (isSourceBased || isDocker) && <StepVariables kind={kind} />}
            {step === "version"    && kind && isDb && <StepVersion kind={kind} />}
            {step === "storage"    && kind && isDb && <StepStorage kind={kind} />}
            {step === "advanced"   && kind && isDb && <StepAdvancedDb kind={kind} />}
            {step === "review"     && kind && <StepReview kind={kind} />}
          </div>
        </div>

        <div className={`flex shrink-0 items-center gap-2 border-t ${layout === "page" ? "bg-card" : "bg-transparent"} ${layout === "dialog" ? "px-[18px] py-3" : "px-5 py-3"}`}>
          {layout === "page" ? (
            <Button
              variant="outline" size="sm" className="h-8"
              render={() => <Link to="/$orgSlug/$projectSlug" params={{ orgSlug, projectSlug }}>Cancel</Link>}
            />
          ) : (
            <Button variant="outline" size="sm" className="h-8" onClick={() => onCancel?.()}>Cancel</Button>
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
```

- [ ] **Step 2: Verify with tsc**

Run: `bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/projects/components/new-resource/wizard.tsx
git commit -m "refactor(web): add new wizard.tsx with Page/Dialog variants on form context"
```

---

## Task 21: Switch route + dialogs to the new wizard, delete the old files

**Files:**
- Modify: `apps/web/src/routes/_app/$orgSlug/$projectSlug/new-resource.tsx`
- Modify: `apps/web/src/features/projects/components/new-resource/new-resource-dialogs.tsx`
- Delete: `apps/web/src/features/projects/components/new-resource/new-resource-wizard.tsx`
- Delete: `apps/web/src/features/projects/components/new-resource/schema.ts`

- [ ] **Step 1: Update the route to render `<PageResourceWizard>` and add `step` to `validateSearch`**

```tsx
// apps/web/src/routes/_app/$orgSlug/$projectSlug/new-resource.tsx
import { z } from "zod";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { PageResourceWizard } from "@/features/projects/components/new-resource/wizard";
import { STEP_IDS, type Step } from "@/features/projects/components/new-resource/schemas";
import { ID_PREFIX, type Slug } from "@otterstack/shared/id";

const zNewResourceSearch = z.object({
  kind: z.string().optional(),
  step: z.enum(STEP_IDS as readonly [Step, ...Step[]]).optional(),
});

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/new-resource")({
  validateSearch: zNewResourceSearch,
  component: RouteComponent,
});

function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });
  const { kind } = Route.useSearch();

  return (
    <PageResourceWizard
      orgSlug={organization.slug}
      projectSlug={project.slug as Slug<typeof ID_PREFIX.project>}
      projectName={project.name}
      initialKind={kind ?? null}
    />
  );
}
```

- [ ] **Step 2: Update `new-resource-dialogs.tsx`**

Replace the `ResourceWizard` import with `DialogResourceWizard`. The kind-picker dialog continues using local `useState`, but renders `<KindPicker value={kindId} onChange={setKindId} />` instead of `<StepKind kindId={...} setKindId={...} />` (since `StepKind` now requires form context).

```tsx
// apps/web/src/features/projects/components/new-resource/new-resource-dialogs.tsx
import { ID_PREFIX, type Slug } from "@otterstack/shared/id";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { DialogResourceWizard } from "@/features/projects/components/new-resource/wizard";
import { KindPicker } from "@/features/projects/components/new-resource/kind-picker";
import { SERVICE_KINDS } from "@/features/projects/data/service-kinds";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/shared/components/ui/dialog";

// ResourceKindDialog -- replace <StepKind .../> with <KindPicker value={kindId} onChange={setKindId} />.

// ResourceOverlayDialog -- replace <ResourceWizard layout="dialog" .../> with <DialogResourceWizard .../>.
```

- [ ] **Step 3: Delete the old files**

```bash
rm apps/web/src/features/projects/components/new-resource/new-resource-wizard.tsx
rm apps/web/src/features/projects/components/new-resource/schema.ts
```

- [ ] **Step 4: Verify with tsc**

Run: `bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Regenerate route tree if needed**

Run: `bunx tanstack-router-cli generate` (or the project's equivalent — `bun dev` regenerates on save). Confirm `apps/web/src/route-tree.gen.ts` reflects the new `validateSearch`.

- [ ] **Step 6: Manual browser smoke**

Start: `bun dev`
- Open `http://otterstack.localhost/<org>/<proj>/new-resource`. Confirm the wizard renders, kind step is interactive.
- Pick a database kind. Confirm advancing to Version step updates the URL to `?step=version`.
- Refresh the page. Confirm you land on the same step.
- Click browser Back. Confirm you return to `?step=kind`.
- Open the overlay-wizard from the project header. Confirm it opens in dialog layout and the URL does NOT change as you advance steps.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/routes/_app/$orgSlug/$projectSlug/new-resource.tsx \
        apps/web/src/features/projects/components/new-resource/new-resource-dialogs.tsx \
        apps/web/src/route-tree.gen.ts
git rm apps/web/src/features/projects/components/new-resource/new-resource-wizard.tsx \
       apps/web/src/features/projects/components/new-resource/schema.ts
git commit -m "$(cat <<'EOF'
refactor(web): switch new-resource flow to context-driven wizard

Route renders <PageResourceWizard> with step in ?step= search param.
Dialogs render <DialogResourceWizard>. Kind-picker dialog uses the
extracted <KindPicker> primitive. Old wizard + schema files removed.
EOF
)"
```

---

## Task 22: Manual validation pass — per-step gate + multi-error rendering

The wizard is now wired end-to-end. Verify the validation behaviour with the browser.

**Files:** None (manual verification).

- [ ] **Step 1: Validation gate blocks Continue**

In a fresh page session:
- Land on Kind step. Without picking a kind, click "Continue". Confirm:
  - The wizard stays on Kind.
  - The kindId field shows the "Select a resource type" error.

- [ ] **Step 2: Multi-error render**

Pick a source-based kind. Land on Source step. Clear `repo` and `name`. Click Continue. Confirm:
- Both errors render simultaneously (the `errors.map(...)` in TextField is working).
- The Continue button does not advance.

- [ ] **Step 3: Failing-step indicator**

Walk to Review. Confirm any incomplete prior step renders in red in the Stepper.

- [ ] **Step 4: Submit happy path**

Fill every required field. On Review, click "Create & deploy". Confirm:
- `console.log("submit", payload)` shows the payload **without** `__step`.
- Wizard calls `onComplete` (page layout: navigates back; dialog layout: closes).

- [ ] **Step 5: Commit nothing — just record the result**

If all five checks pass, the refactor is functionally complete. If any fail, file an issue and fix before merging.

---

## Self-Review Notes

This plan covers every spec requirement in the architecture section, plus the testing checklist. Deep-link guard lives inside `PageResourceWizard` (Task 20 effect). The `STEP_IDS` constant is exported from `schemas/index.ts` (Task 6) and consumed by the route's `validateSearch` (Task 21). The `Step` type is the single source of truth — re-exported from `steps/index.tsx` for backwards compatibility with any consumer that imports it from `./steps`.

If `bunx` triggers the cSpell warning, the `.vscode/settings.json` update from the spec rework already covers it.
