# New Resource Flow — Dialog & Overlay Variants

## Problem

The current "create new resource" flow on the project page is a single Link button that navigates to `/$orgSlug/$projectSlug/new-resource` — a full-page 4-to-6 step wizard. Two alternative UX patterns may feel better:

- **Variant A — Kind-picker dialog:** A dialog appears first with only the kind picker. After picking a kind, the user is routed to the page wizard, which skips the kind step. Front-loads the most consequential choice and reduces friction for users who know what they want.
- **Variant B — Full overlay wizard:** The entire wizard runs inside a large centered modal. The user never leaves the project page. Cancel is a single Esc instead of a back navigation. No half-state where the user has routed to `/new-resource` but hasn't committed to anything.

We want to ship both variants alongside the existing page-route flow so they can be compared in the live demo (`otterstack-demo-1.pages.dev/project/proj_acme`) before picking a winner.

## Scope

Build the two variants as additive UX surfaces on the project page. The existing `+ Add resource` Link must remain functional and unchanged so it can serve as the baseline. None of the step components (`step-kind.tsx`, `step-version.tsx`, `step-resources.tsx`, `step-storage.tsx`, `step-advanced-db.tsx`, `step-review.tsx`) get edited.

**Out of scope for v1:**

- Confirm-before-close prompt when the overlay has unsaved data.
- Wiring Create to the real `resource.create` oRPC procedure — the wizard's "Create" button is already a no-op in the current page route. Both variants inherit that no-op so we're evaluating the flow, not persistence.
- Success navigation to the new resource detail page — both variants just close.
- Mobile responsiveness beyond what shadcn `Dialog` provides by default.

## Architecture

### 1. `features/projects/components/new-resource/new-resource-wizard.tsx` *(new)*

Extracts the wizard logic currently inlined in `routes/_app/$orgSlug/$projectSlug/new-resource.tsx`'s `RouteComponent`:

- `useForm` (tanstack-form) with `resourceSchema` + `resourceDefaults`.
- `useState<Step>` for step navigation.
- Step routing logic (DB-kind branch vs simple-kind branch).
- Renders the `<Stepper>` plus the current step component, plus the Prev / Next / Create footer.

**Props:**

```ts
type NewResourceWizardProps = {
  orgSlug: string;
  projectSlug: Slug<typeof ID_PREFIX.project>;
  initialKind?: string | null;
  initialStep?: Step;
  onComplete?: () => void;
  onCancel?: () => void;
  layout?: "page" | "dialog";
};
```

- `initialKind` pre-fills the form's `kindId` field. When set, the wizard starts on the `initialStep` (defaults to `"version"` if `initialKind` is provided, else `"kind"`).
- `layout="dialog"` tightens vertical padding, drops the bottom "Cancel" Link (the Dialog has its own close mechanisms), and constrains the inner scroll area to the Dialog body.
- `onComplete` fires after a successful Create (currently the no-op path). `onCancel` is wired to a "Cancel" button in dialog layout — page layout uses a route-back Link instead.

### 2. `features/projects/components/new-resource/new-resource-dialogs.tsx` *(new)*

Two named exports.

**`<NewResourceKindDialog>` — variant A**

```ts
type NewResourceKindDialogProps = {
  orgSlug: string;
  projectSlug: Slug<typeof ID_PREFIX.project>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};
```

Renders shadcn `<Dialog>` containing:

- `<DialogHeader>` with title "Choose a resource type" and description "What kind of thing do you want to add to this project?"
- The existing `<StepKind>` component (same 4-tab picker as the page) with a local `useState` for `kindId`.
- Footer: "Cancel" + "Configure →" buttons. "Configure" is disabled until a kind is picked.

On confirm: `navigate({ to: "/$orgSlug/$projectSlug/new-resource", params, search: { kind: kindId } })`, then `onOpenChange(false)`.

**`<NewResourceOverlayDialog>` — variant B**

```ts
type NewResourceOverlayDialogProps = {
  orgSlug: string;
  projectSlug: Slug<typeof ID_PREFIX.project>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};
```

Renders a large shadcn `<Dialog>` (`max-w-[920px]`, `h-[80vh]`, `overflow-hidden` with internal scroll on the wizard body) containing `<NewResourceWizard layout="dialog" onComplete={...} onCancel={...} />`. Both completion and cancellation close the dialog via `onOpenChange(false)`. Esc and backdrop click work via Dialog defaults.

### 3. `routes/_app/$orgSlug/$projectSlug/new-resource.tsx` *(refactored, behavior preserved)*

The `RouteComponent` shrinks to:

```tsx
function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });
  const { kind } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <NewResourceWizard
      layout="page"
      orgSlug={organization.slug}
      projectSlug={project.slug as Slug<typeof ID_PREFIX.project>}
      initialKind={kind ?? null}
      onComplete={() => navigate({ to: "/$orgSlug/$projectSlug", params: { orgSlug: organization.slug, projectSlug: project.slug } })}
    />
  );
}
```

Adds a `validateSearch` to the route definition that accepts `kind?: string`. This lets variant A deep-link to the wizard pre-loaded past step-kind.

All extracted wizard logic moves to `NewResourceWizard`. The route file ends up ~30 lines instead of 379.

### 4. `routes/_app/$orgSlug/$projectSlug/index.tsx` *(small addition)*

Below the existing `+ Add resource` Link, add two more buttons with identical styling:

- `+ Add (dialog)` — controls `<NewResourceKindDialog>` via local `useState`.
- `+ Add (overlay)` — controls `<NewResourceOverlayDialog>` via local `useState`.

All three live in the same horizontal row so the variants are one-click apart for comparison.

## Data Flow

**Variant A:**

1. User clicks `+ Add (dialog)` → local state sets dialog open.
2. `NewResourceKindDialog` renders `<StepKind>` with a local `kindId` state.
3. User picks a kind → `kindId` updates → "Configure →" enables.
4. User clicks "Configure →" → `navigate(..., { search: { kind: kindId } })`, dialog closes.
5. Page route mounts, reads `search.kind`, instantiates `<NewResourceWizard initialKind={kind} initialStep="version">`.
6. Wizard renders step-version directly. User completes remaining steps as in the original flow.

**Variant B:**

1. User clicks `+ Add (overlay)` → local state sets dialog open.
2. `NewResourceOverlayDialog` renders `<NewResourceWizard layout="dialog">` with no `initialKind` and `initialStep="kind"`.
3. User progresses through all steps inside the Dialog.
4. On Create: `onComplete` fires (currently no-op) → `onOpenChange(false)` closes the dialog.
5. On Cancel / Esc / backdrop: `onOpenChange(false)` closes the dialog. Form state is discarded.

**Existing page flow:**

1. User clicks `+ Add resource` → routes to `/new-resource` with no search params.
2. `NewResourceWizard` mounts with `initialKind=null`, `initialStep="kind"`.
3. Behavior identical to today.

## Components Used

- shadcn `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `DialogTrigger` (`apps/web/src/shared/components/ui/dialog.tsx`).
- shadcn `Button` for dialog footer buttons.
- Existing `<NewResourceWizard>` (newly extracted).
- All existing step components reused unchanged.

## What Stays Untouched

- `features/projects/components/new-resource/step-*.tsx` — zero edits.
- `features/projects/components/new-resource/stepper.tsx` — zero edits.
- `features/projects/components/new-resource/schema.ts` and `form-primitives.tsx` — zero edits.
- The route URL `/$orgSlug/$projectSlug/new-resource` — keeps working, gains an optional `?kind=` search param.
- The existing `+ Add resource` Link in `index.tsx` — keeps working, unchanged styling and target.

## Error Handling & Edge Cases

- **Variant A: user clicks `+ Add (dialog)` then closes without picking** → dialog closes, no navigation. Same state as if they never opened it.
- **Variant A: user navigates back from page wizard after picking** → returns to project page; the `?kind=` query string disappears from the URL on back navigation per TanStack Router defaults.
- **Variant A: deep-linked URL `/new-resource?kind=invalid-id`** → page wizard mounts with `initialKind="invalid-id"`, `initialStep="version"`. The `<StepVersion>` component handles unknown kinds by showing whatever the lookup falls through to. Acceptable for v1 since this is a comparison surface, not a public API.
- **Variant B: user fills several fields then closes** → form state is discarded with the unmounted component. No persistence, no warning prompt. v2 can add a confirmation if this proves disruptive.
- **Variant B: user resizes window below ~600px wide** → Dialog content adapts via shadcn defaults; overlay shrinks toward fullscreen. Not optimized but functional.

## Testing

Manual verification in the running app:

- Click `+ Add resource` — original page wizard works, no regression. All steps reachable, Prev/Next nav works.
- Click `+ Add (dialog)` — dialog opens with 4-tab kind picker. Picking a kind enables Configure. Configure navigates to `/new-resource?kind=<id>` and the wizard opens on step-version. Cancel/Esc closes with no nav.
- Click `+ Add (overlay)` — large Dialog opens with wizard inside. All steps work end-to-end inside the dialog. Create closes the dialog. Cancel/Esc/backdrop closes the dialog. Form data is discarded on close.
- Refresh `/new-resource?kind=postgres` directly in the URL — page mounts at step-version with postgres pre-selected.
- TypeScript: `bunx tsc --noEmit` passes for the touched files.

No automated tests added in v1. The comparison is intentionally short-lived — once a flow wins, the loser gets deleted and tests get written against the winner.

## Open Decisions Deferred

- Whether to wire Create to the real `resource.create` oRPC procedure as part of this change, or keep it a no-op until the comparison concludes. **Decision: no-op for v1**, both variants inherit existing behavior.
- Whether to add analytics/feature-flag plumbing to track which variant gets used. **Decision: no for v1** — manual comparison only.
- Whether the kind picker dialog (variant A) should be the same component as `<StepKind>` or a more compact dialog-specific variant. **Decision: reuse `<StepKind>` as-is** — minimizes duplication and proves the picker works at dialog size before considering a custom layout.
