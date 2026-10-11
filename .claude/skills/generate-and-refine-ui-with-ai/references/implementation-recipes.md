# Implementation recipes

These are small implementation artifacts for recurring refinements. Adapt them to the existing stack and design system; do not introduce a parallel component system just to use them.

## Replace emoji controls with one icon system

```tsx
import { BarChart3, Copy, MoreHorizontal } from "lucide-react";

export function LinkActions() {
  return (
    <div aria-label="Link actions" className="linkActions">
      <button type="button">
        <BarChart3 aria-hidden="true" />
        <span>Analytics</span>
      </button>
      <button type="button" aria-label="Copy short link">
        <Copy aria-hidden="true" />
      </button>
      <button type="button" aria-label="More link actions">
        <MoreHorizontal aria-hidden="true" />
      </button>
    </div>
  );
}
```

Use a visible label for the primary action. An icon-only secondary action still needs an accessible name and a discoverable tooltip for unfamiliar symbols.

## Demote repeated secondary actions into an overflow menu

```tsx
import { MoreHorizontal } from "lucide-react";

export function LinkRowActions({ onCopy, onDelete }: {
  onCopy: () => void;
  onDelete: () => void;
}) {
  return (
    <Menu>
      <Menu.Trigger aria-label="More actions for this link">
        <MoreHorizontal aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Content align="end">
        <Menu.Item onSelect={onCopy}>Copy link</Menu.Item>
        <Menu.Separator />
        <Menu.Item tone="danger" onSelect={onDelete}>Delete link…</Menu.Item>
      </Menu.Content>
    </Menu>
  );
}
```

`Menu` represents the project's accessible menu primitive. It must support arrow-key navigation, Escape, focus restoration, and collision-aware positioning. Keep the row's primary action outside the menu.

## Make a KPI carry trend, not decoration

```tsx
type Point = { x: number; y: number };

export function KpiCard({ label, value, trend, points }: {
  label: string;
  value: string;
  trend: string;
  points: Point[];
}) {
  return (
    <article aria-labelledby={`kpi-${label}`} className="kpiCard">
      <div>
        <p id={`kpi-${label}`}>{label}</p>
        <strong>{value}</strong>
        <span className="srOnly">{trend}</span>
      </div>
      <Sparkline points={points} aria-hidden="true" />
    </article>
  );
}
```

The sparkline is supplementary. Expose the direction and period in text for screen readers and users who cannot infer it from shape or color. Do not render synthetic points as if they were product data.

## Keep progress value and visual length in sync

```tsx
type ProgressProps = { label: string; value: number };

export function ProjectProgress({ label, value }: ProgressProps) {
  const bounded = Math.min(100, Math.max(0, value));

  return (
    <div className="progress">
      <div className="progress__label">
        <span>{label}</span>
        <span>{bounded}%</span>
      </div>
      <progress max="100" value={bounded} aria-label={`${label}: ${bounded}%`} />
    </div>
  );
}
```

Do not invent a percentage for indeterminate work. Use an indeterminate state and explain what the system is waiting for.

## Use tokens for state, not one-off color

```css
:root {
  --surface-canvas: #0d0f0e;
  --surface-raised: #151815;
  --text-primary: #f3f5f3;
  --text-muted: #a5ada7;
  --state-active: #65d493;
  --state-warning: #f2bd63;
  --state-danger: #f47a7a;
  --focus-ring: #8fc7ff;
}

.status[data-state="active"] {
  color: var(--state-active);
}

.control:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 3px;
}
```

Pair state color with text, icon shape, or position so meaning survives grayscale and color-vision differences.

## Make a short form responsive without turning it into a side panel

```css
.createLinkForm {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.createLinkForm__full {
  grid-column: 1 / -1;
}

@media (max-width: 42rem) {
  .createLinkForm {
    grid-template-columns: 1fr;
  }

  .createLinkForm__full {
    grid-column: auto;
  }
}
```

Verify dialog labeling, initial focus, tab containment, Escape behavior, focus restoration, validation announcement, and mobile viewport height in the actual modal implementation.

## Record visual changes beside code changes

```md
| Change | Before | Hypothesis | After | Result |
|---|---|---|---|---|
| KPI icon → sparkline | before-kpi.png | trend answers direction | after-kpi.png | pass: direction visible |
| side panel → modal | before-form.png | form is short/self-contained | after-form.png | needs mobile-height test |
```

This ledger prevents “looks better” from becoming the only acceptance criterion.
