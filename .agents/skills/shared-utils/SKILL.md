---
name: somnara-shared-utils
description: somnara convention for reusing shared utilities. Use this skill BEFORE writing any helper, utility, or "small" function — id generation, stripping undefined from objects, duration/time math, or date/time handling. Reuse what already exists in `@somnara/shared`; if a generic helper is missing, add it there instead of inlining a local copy. Triggers when about to create a util/helper, normalize objects, build patch payloads, generate ids, or work with durations or dates.
---

# somnara Shared Utilities

Single home for cross-cutting helpers: `@somnara/shared` (`packages/shared/src`).
**Reuse it. Do not reinvent it.**

Failure mode this skill prevents: an agent writes a one-off `stripUndefined`,
`genId`, or `toMillis` inline when an audited, typed version already exists.

## Rule

1. **Check `@somnara/shared` first.** Read `packages/shared/src/index.ts`.
2. **If it exists, import it.** `import { createId } from "@somnara/shared";`
3. **If it does not exist but is generic**, add it to `@somnara/shared`,
   export from `index.ts`, and import it back. Do **not** inline a local copy.
4. **If genuinely local** (one call site, app-specific), keep it local.

## Package structure

```
packages/shared/
  package.json          # ESM, no build step — raw .ts served source-to-source
  src/
    index.ts            # barrel re-exports
    id.ts               # ID generation + branded types + prefix registry
    object.ts           # omitUndefined
    date.ts             # Luxon re-exports (single owner of luxon dep)
    duration/
      duration.ts       # typed duration math (standalone sub-module)
```

**Imports** — two styles, both valid:
```ts
import { createId, DateTime } from "@somnara/shared";       // barrel
import { createId } from "@somnara/shared/id";              // sub-path
```
Barrel is the dominant pattern across the codebase. Use it unless you need to
avoid pulling in unrelated modules.

## ID system

Library: **`@paralleldrive/cuid2`**. Format: **`{prefix}_{cuid2}`**.

### Branded types

```ts
type Id<P extends string = string> = string & { readonly __brand: P };
```
Uses a plain `__brand` property (not `unique symbol`) to survive
TS4023/TS4058 declaration-emit issues with oRPC.

Every prefix has a **named type alias** (e.g. `RiskId`, `ControlId`,
`OrganizationId`). Prefer the alias at call sites over `Id<typeof ID_PREFIX.x>`.

```ts
import type { RiskId, ControlId } from "@somnara/shared";

function linkRiskToControl(riskId: RiskId, controlId: ControlId) { ... }
```

### Creating IDs

```ts
import { createId, ID_PREFIX } from "@somnara/shared";

createId("risk");            // "risk_clx1abc2def3ghi"
createId(ID_PREFIX.risk);    // same, with autocomplete
```

For **seed scripts** (idempotent with `ON CONFLICT DO NOTHING`):
```ts
import { createDeterministicId, ID_PREFIX } from "@somnara/shared";

createDeterministicId(ID_PREFIX.assetTemplateItem, "atpl_xyz", 1);
// "atpli_atpl_xyz-1"  — same input always produces same output
```

### Parsing & narrowing

```ts
import { idPrefix, hasPrefix } from "@somnara/shared";

idPrefix("risk_clx1abc");          // "risk"
hasPrefix(someId, "risk");         // type guard → someId is Id<"risk">
```

### Zod validation — `zId(prefix)`

Runtime validation that the string starts with the expected prefix,
outputting `Id<P>`:

```ts
import { zId } from "@somnara/shared";
import { z } from "zod";

const schema = z.object({ riskId: zId("risk") });
// Validates "risk_..." and outputs typed Id<"risk">
```

Use `zId` in oRPC `.input()` schemas, API route params, and anywhere
user-supplied IDs enter the system.

### Adding a new entity ID

When creating a new DB table / entity, follow this exact checklist in
`packages/shared/src/id.ts`:

1. **Add the prefix** to the `ID_PREFIX` const object under the correct
   semantic group (with a comment if starting a new group):
   ```ts
   // Widgets
   widget: "wgt",
   ```
2. **Add the branded type alias** below the existing aliases:
   ```ts
   export type WidgetId = Id<typeof ID_PREFIX.widget>;
   ```
3. The barrel (`index.ts`) already re-exports `type * from "./id"`, so
   the new type is automatically available via `@somnara/shared`.

**Naming conventions:**
- Prefix string: short lowercase abbreviation (2-6 chars)
- Type alias: `PascalCase` entity name + `Id` suffix
- `ID_PREFIX` key: `camelCase` entity name

## Objects — `omitUndefined`

```ts
import { omitUndefined } from "@somnara/shared";
```

Shallow-strips `undefined` entries; preserves `null`.
Semantic: `null` = "clear the column", `undefined` = "no change".

Use for partial-patch payloads (Drizzle update sets, oRPC inputs).

## Durations — typed time quantities

Import via sub-path (not in barrel):
```ts
import { Duration, minutesOf, millisecondsFrom } from "@somnara/shared/duration/duration";
```

Wrap raw numbers into typed durations, convert between units:
```ts
const ttl = minutesOf(15);          // Minutes { value: 15, unit: "m" }
const ms  = millisecondsFrom(ttl);  // 900000
```

Namespace API: `Duration.minutes.of(15)`, `Duration.milliseconds.from(ttl)`.

## Dates and times — Luxon

**Luxon is owned by `@somnara/shared`.** Never add `luxon` to any other
`package.json`. Never `import ... from "luxon"` in app code.

```ts
import { DateTime, Interval } from "@somnara/shared";
```

If a Luxon export is missing from the barrel, add it to
`packages/shared/src/date.ts` + `index.ts`.

> Luxon's own `Duration` is intentionally NOT re-exported (name clash).
> Use shared `Duration`/`*Of`/`*From` for time quantities; `DateTime` for dates.

> `react-day-picker` call sites still use native `Date`. Convert at the
> boundary: `DateTime.fromJSDate(d)` / `dt.toJSDate()`.

## Anti-patterns

```ts
// ❌ inline undefined-stripping
const patch = { ...(name !== undefined ? { name } : {}) };
// ✅
import { omitUndefined } from "@somnara/shared";
const patch = omitUndefined({ name, email: email?.trim().toLowerCase() });
```

```ts
// ❌ magic-number durations
const ttlMs = 15 * 60 * 1000;
// ✅
import { minutesOf, millisecondsFrom } from "@somnara/shared/duration/duration";
const ttlMs = millisecondsFrom(minutesOf(15));
```

```ts
// ❌ hand-rolled ID
const id = `risk_${crypto.randomUUID()}`;
// ✅
import { createId } from "@somnara/shared";
const id = createId("risk");
```

```ts
// ❌ untyped ID parameter
function getRisk(id: string) { ... }
// ✅
import type { RiskId } from "@somnara/shared";
function getRisk(id: RiskId) { ... }
```

```ts
// ❌ raw prefix check
if (id.startsWith("risk_")) { ... }
// ✅
import { hasPrefix } from "@somnara/shared";
if (hasPrefix(id, "risk")) { /* id is now Id<"risk"> */ }
```

## Final check

Ask: "Does `@somnara/shared` already export this, or should it?" If yes,
route through the shared package. Only keep it local when app-specific.
