# Environment Switcher Overlay

## Overview

A carousel-based overlay for switching between project environments (dev, staging, prod, custom). Triggered by a keyboard shortcut, it presents environments as cards in a horizontally scrollable carousel with the active environment centered and adjacent ones peeking from the sides.

## Motivation

Projects can have multiple deployment environments, each with its own set of resources in the xyflow canvas. Users need a fast, keyboard-driven way to switch between them without leaving the project view.

## Architecture

### Components

**`EnvironmentSwitcher`** — The overlay component.
- Renders as a fixed overlay with backdrop blur on top of the project layout
- Contains the carousel, pagination dots, and dismiss controls
- Manages open/close state and active selection

**`EnvironmentCard`** — Individual environment card in the carousel.
- Displays environment name (expandable later with summary info)
- Scales and fades based on position: center card is full size, side cards are smaller and faded

**`useEnvironmentSwitcher`** — Hook for managing switcher state.
- Open/close state
- Current carousel index
- Keyboard navigation (arrows, enter, escape)

### Keyboard Interaction

- **`E`** key — opens the overlay. Registered via `@tanstack/react-hotkeys` `useHotkey` hook. The `ignoreInputs` option (defaults to `true` for single keys) prevents firing in text inputs/textareas. The hotkey is only active when the overlay is closed (`enabled: !isOpen`).
- **ArrowLeft / ArrowRight** — navigate between environments (active only when overlay is open)
- **Enter** — select the focused environment and close
- **Escape** — dismiss without changing

### Data Flow

1. User presses `E` — overlay opens with current environment centered
2. User arrows through carousel — Framer Motion animates card transitions
3. User presses Enter — `env` search param updates via TanStack Router's `navigate`
4. Route re-renders with new `env` value

**Note**: Wiring per-environment node state to the xyflow canvas is out of scope for this feature. The switcher updates the `env` search param only. Canvas reactivity to `env` changes is a separate task.

### Route Integration

The project layout at `/_dashboard/project/$projectId/layout.tsx` already has an `env` search param validated with Zod (defaults to `"development"`). The `env` search param value corresponds to `Environment.name`. The switcher updates this param:

```ts
navigate({
  search: (prev) => ({ ...prev, env: selectedEnvironment.name }),
})
```

The Zod schema remains `z.string()` (not an enum) since users can create custom environments.

### Environment Data

For now, environments are defined client-side per project. The data model:

```ts
type Environment = {
  id: string
  name: string       // URL-safe slug used in the `env` search param, e.g. "development", "staging", "production"
  label: string      // display name, e.g. "Development"
}
```

This will move to the database (Drizzle schema) when project persistence is implemented.

### Carousel Behavior

- Active card is centered, full opacity, full scale
- Adjacent cards are visible on the sides, reduced opacity (~0.5), reduced scale (~0.85)
- Smooth transitions via Framer Motion `animate` with spring physics
- Pagination dots at the bottom indicate position, clickable
- Wrapping: carousel does NOT wrap — stops at first/last

### Visual Design

- Overlay: fixed inset-0, `bg-black/60 backdrop-blur-sm`, z-50
- Cards: `bg-card border border-border rounded-xl`, sized ~280px wide
- Active card: `scale-100 opacity-100`
- Side cards: `scale-85 opacity-50`
- Dots: small circles at bottom center, active dot is `bg-foreground`, inactive is `bg-muted-foreground/40`
- Dismiss: click backdrop or press Escape

## File Structure

```
apps/web/src/features/environment-switcher/
  components/
    environment-switcher.tsx    # Main overlay + carousel
    environment-card.tsx        # Individual card
  hooks/
    use-environment-switcher.ts # State + keyboard logic
  index.ts                     # Public exports
```

## Dependencies

- `@tanstack/react-hotkeys` — keyboard shortcut registration (new dependency, needs `bun add @tanstack/react-hotkeys`)
- `motion/react` — carousel animations (already installed)
- `@tanstack/react-router` — route search param updates (already installed)

## Testing

- Hotkey opens/closes overlay
- Arrow keys navigate between cards
- Enter selects environment and updates route
- Escape dismisses without change
- Correct card is centered based on current `env` param
