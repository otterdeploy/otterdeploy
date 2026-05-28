# Environment Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a keyboard-triggered carousel overlay that lets users switch between project environments.

**Architecture:** A `useEnvironmentSwitcher` hook manages open/close state and carousel index. The `EnvironmentSwitcher` component renders a fixed overlay with Framer Motion-animated cards. Selecting an environment updates the `env` search param via TanStack Router, which the project layout already reads.

**Tech Stack:** @tanstack/react-hotkeys (v0.4.2), motion/react (installed), @tanstack/react-router (installed), Tailwind CSS, shadcn-ui

**Spec:** `docs/superpowers/specs/2026-03-20-environment-switcher-design.md`

**API Note:** `@tanstack/react-hotkeys` exports `useHotkey` (singular). Signature: `useHotkey(hotkey, callback, options?)`. The `ignoreInputs` option (defaults to `true` for single keys) prevents firing in text inputs. The `enabled` option controls whether the hotkey is active.

---

## File Structure

```
apps/web/src/features/environment-switcher/
  types.ts                              # Environment type definition
  hooks/
    use-environment-switcher.ts         # Open/close state, carousel index, keyboard nav
  components/
    environment-switcher.tsx            # Overlay + carousel + dots
    environment-card.tsx                # Individual card with scale/opacity animation
  index.ts                             # Public exports

Modify:
  apps/web/src/routes/_dashboard/project/$projectId/layout.tsx  # Mount switcher + wire hotkey
```

---

### Task 1: Install dependency

- [ ] **Step 1: Install @tanstack/react-hotkeys**

```bash
cd apps/web && bun add @tanstack/react-hotkeys
```

- [ ] **Step 2: Verify installation**

```bash
bun pm ls | grep hotkeys
```

Expected: `@tanstack/react-hotkeys` appears in output.

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json bun.lock
git commit -m "chore(web): add @tanstack/react-hotkeys dependency"
```

---

### Task 2: Environment type definition

**Files:**
- Create: `apps/web/src/features/environment-switcher/types.ts`

- [ ] **Step 1: Create the type file**

```ts
export type Environment = {
  id: string
  name: string   // URL-safe slug, used in `env` search param
  label: string  // Display name
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/features/environment-switcher/types.ts
git commit -m "feat(web): add Environment type for environment switcher"
```

---

### Task 3: useEnvironmentSwitcher hook

**Files:**
- Create: `apps/web/src/features/environment-switcher/hooks/use-environment-switcher.ts`

- [ ] **Step 1: Write the hook**

This hook manages:
- `isOpen` state (boolean)
- `activeIndex` (number) — which card is currently focused in the carousel
- `setActiveIndex` — direct setter for dot navigation
- `open(currentEnvName)` — opens overlay, sets activeIndex to match the current env
- `close()` — closes overlay without changing env
- `select()` — returns the currently focused environment and closes
- `next()` / `prev()` — move activeIndex within bounds (no wrapping)

```ts
import { useCallback, useState } from "react"
import type { Environment } from "../types"

export function useEnvironmentSwitcher(environments: Environment[]) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const open = useCallback(
    (currentEnvName: string) => {
      const index = environments.findIndex((e) => e.name === currentEnvName)
      setActiveIndex(index >= 0 ? index : 0)
      setIsOpen(true)
    },
    [environments],
  )

  const close = useCallback(() => {
    setIsOpen(false)
  }, [])

  const next = useCallback(() => {
    setActiveIndex((i) => Math.min(i + 1, environments.length - 1))
  }, [environments.length])

  const prev = useCallback(() => {
    setActiveIndex((i) => Math.max(i - 1, 0))
  }, [])

  const select = useCallback(() => {
    setIsOpen(false)
    return environments[activeIndex]
  }, [environments, activeIndex])

  return { isOpen, activeIndex, setActiveIndex, open, close, next, prev, select }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/features/environment-switcher/hooks/use-environment-switcher.ts
git commit -m "feat(web): add useEnvironmentSwitcher hook"
```

---

### Task 4: EnvironmentCard component

**Files:**
- Create: `apps/web/src/features/environment-switcher/components/environment-card.tsx`

- [ ] **Step 1: Write the component**

Each card receives its offset from center (0 = active, -1 = left, 1 = right, etc.) and animates scale/opacity accordingly.

```tsx
import * as motion from "motion/react-client"
import type { Environment } from "../types"

export function EnvironmentCard({
  environment,
  offset,
  onClick,
}: {
  environment: Environment
  offset: number // 0 = center, negative = left, positive = right
  onClick: () => void
}) {
  const isActive = offset === 0
  const absOffset = Math.abs(offset)

  return (
    <motion.div
      className="absolute cursor-pointer rounded-xl border border-border bg-card p-6 w-[280px]"
      animate={{
        x: offset * 300,
        scale: isActive ? 1 : Math.max(0.85 - absOffset * 0.05, 0.7),
        opacity: isActive ? 1 : Math.max(0.5 - absOffset * 0.15, 0.1),
        zIndex: 10 - absOffset,
      }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      onClick={onClick}
    >
      <h3 className="text-lg font-medium text-foreground">{environment.label}</h3>
      <p className="text-sm text-muted-foreground mt-1">{environment.name}</p>
    </motion.div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/features/environment-switcher/components/environment-card.tsx
git commit -m "feat(web): add EnvironmentCard component"
```

---

### Task 5: EnvironmentSwitcher overlay component

**Files:**
- Create: `apps/web/src/features/environment-switcher/components/environment-switcher.tsx`

- [ ] **Step 1: Write the component**

The overlay renders a backdrop, a row of cards (positioned via offset from `activeIndex`), and pagination dots at the bottom.

```tsx
import * as motion from "motion/react-client"
import { AnimatePresence } from "motion/react"
import type { Environment } from "../types"
import { EnvironmentCard } from "./environment-card"

export function EnvironmentSwitcher({
  environments,
  activeIndex,
  isOpen,
  onClose,
  onSelect,
  onSetIndex,
}: {
  environments: Environment[]
  activeIndex: number
  isOpen: boolean
  onClose: () => void
  onSelect: (index: number) => void
  onSetIndex: (index: number) => void
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          {/* Carousel */}
          <div
            className="relative flex items-center justify-center h-48"
            onClick={(e) => e.stopPropagation()}
          >
            {environments.map((env, index) => (
              <EnvironmentCard
                key={env.id}
                environment={env}
                offset={index - activeIndex}
                onClick={() => onSelect(index)}
              />
            ))}
          </div>

          {/* Dots */}
          <div
            className="absolute bottom-12 left-1/2 -translate-x-1/2 flex gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {environments.map((env, index) => (
              <button
                key={env.id}
                type="button"
                className={`size-2 rounded-full transition-colors ${
                  index === activeIndex
                    ? "bg-foreground"
                    : "bg-muted-foreground/40"
                }`}
                onClick={() => onSetIndex(index)}
              />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/features/environment-switcher/components/environment-switcher.tsx
git commit -m "feat(web): add EnvironmentSwitcher overlay component"
```

---

### Task 6: Public exports

**Files:**
- Create: `apps/web/src/features/environment-switcher/index.ts`

- [ ] **Step 1: Create barrel export**

```ts
export { EnvironmentSwitcher } from "./components/environment-switcher"
export { EnvironmentCard } from "./components/environment-card"
export { useEnvironmentSwitcher } from "./hooks/use-environment-switcher"
export type { Environment } from "./types"
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/features/environment-switcher/index.ts
git commit -m "feat(web): add environment-switcher barrel exports"
```

---

### Task 7: Wire into project layout

**Files:**
- Modify: `apps/web/src/routes/_dashboard/project/$projectId/layout.tsx`

- [ ] **Step 1: Add imports**

Add at the top of the file:

```ts
import { useHotkey } from "@tanstack/react-hotkeys"
import {
  EnvironmentSwitcher,
  useEnvironmentSwitcher,
  type Environment,
} from "@/features/environment-switcher"
```

- [ ] **Step 2: Add placeholder environments and hook setup**

Inside `RouteComponent`, before the existing `useNodesState` call, add:

```ts
const { env } = Route.useSearch()
const navigate = Route.useNavigate()

// Placeholder — will come from API later
const environments: Environment[] = [
  { id: "env-dev", name: "development", label: "Development" },
  { id: "env-staging", name: "staging", label: "Staging" },
  { id: "env-prod", name: "production", label: "Production" },
]

const switcher = useEnvironmentSwitcher(environments)
```

- [ ] **Step 3: Register hotkeys**

After the hook setup, add. Note: `useHotkey` is singular. The `ignoreInputs` option defaults to `true` for single keys like `e`, so it won't fire in text inputs.

```ts
useHotkey("e", () => switcher.open(env), {
  enabled: !switcher.isOpen,
})

useHotkey("Escape", () => switcher.close(), {
  enabled: switcher.isOpen,
})

useHotkey("ArrowLeft", () => switcher.prev(), {
  enabled: switcher.isOpen,
})

useHotkey("ArrowRight", () => switcher.next(), {
  enabled: switcher.isOpen,
})

useHotkey("Enter", () => {
  const selected = switcher.select()
  if (selected) {
    navigate({ search: (prev) => ({ ...prev, env: selected.name }) })
  }
}, {
  enabled: switcher.isOpen,
})
```

- [ ] **Step 4: Mount the EnvironmentSwitcher component**

Add the `EnvironmentSwitcher` component as a sibling after the outer `<div className="p-4 w-full h-screen">`, wrapping the return in a fragment `<>...</>`:

```tsx
return (
  <>
    <div className="p-4 w-full h-screen">
      <ReactFlow ...>
        ...
      </ReactFlow>
      <Outlet />
    </div>
    <EnvironmentSwitcher
      environments={environments}
      activeIndex={switcher.activeIndex}
      isOpen={switcher.isOpen}
      onClose={switcher.close}
      onSelect={(index) => {
        const selected = environments[index]
        if (selected) {
          switcher.close()
          navigate({ search: (prev) => ({ ...prev, env: selected.name }) })
        }
      }}
      onSetIndex={(index) => switcher.setActiveIndex(index)}
    />
  </>
)
```

- [ ] **Step 5: Verify it works**

```bash
cd /Users/jeffersonchukwuka/Developer/playground/otterdeploy && bun dev
```

Open the project page in the browser. Press `E` — overlay should appear. Arrow keys should move between cards. Enter should select. Escape should dismiss. Dots should be clickable.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/_dashboard/project/\$projectId/layout.tsx
git commit -m "feat(web): wire environment switcher into project layout with hotkeys"
```
