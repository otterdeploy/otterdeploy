# Temporal Migration — Spec

## Problem

Every layer of the stack passes `Date` objects around — Drizzle returns `Date`
from `timestamp()` columns, `drizzle-zod` widens those into `z.date()`,
oRPC serializes `Date` to ISO over the wire and rehydrates back to `Date`,
forms hold `Date` in field state, and the UI formats with ad-hoc helpers
(`toLocaleString`, a local `formatRelative`).

`Date` has known foot-guns: it's mutable, time-zone-ambiguous (the same
object behaves as local-or-UTC depending on which method you call),
month-is-zero-indexed, and has no first-class duration type. The ECMAScript
`Temporal` proposal fixes all of this — and at the same time absorbs ~80%
of what we'd reach for `date-fns` to do (arithmetic, comparisons,
durations, time zones).

Goal: move every internal touch point off `Date` and onto `Temporal.*`
types, while keeping the wire format as ISO 8601 strings (so the migration
is non-breaking for any current or future consumer). Where the libraries
we depend on can't produce or consume Temporal types yet, upstream the
support to those repos rather than carrying long-lived local adapters.

## Scope

In-scope (this codebase):

- All `Date` usage in `apps/web`, `packages/api`, and `packages/db`.
- A small `lib/time.ts` helper that wraps the polyfill import and exposes
  the typed conversions and locale-aware formatters our app actually
  needs.
- Removing `date-fns` (we don't currently depend on it — but the
  migration will make sure we don't reach for it as we add features).

Upstream contributions (separate from the in-codebase migration but
tracked here for sequencing):

- `colinhacks/zod` — first-class Temporal validators.
- `drizzle-team/drizzle-orm` — opt-in Temporal column adapters.
- `drizzle-team/drizzle-zod` — emit Temporal schemas when a column opts
  in.
- `unnoq/orpc` — JSON serializer support for Temporal types.
- `tanstack/form` — Temporal-aware adapter / type narrowing where needed.

Out of scope for v1:

- Replacing `Intl.DateTimeFormat` — Temporal interoperates with Intl
  out of the box; we just call `.toLocaleString(locale, options)`.
- Calendar systems other than ISO 8601 — every type we use is the
  default Gregorian/ISO calendar.
- Dropping the polyfill — we'll carry `@js-temporal/polyfill` for as
  long as V8/Bun lack native Temporal. The migration writes code as if
  `Temporal` is global, and the polyfill is imported once at the entry
  point.
- Server-side / Node-only date code (cron schedulers, log timestamps in
  `evlog`, etc.) until the boundary plumbing lands.

## Temporal status check (as of 2026-05-25)

- **Spec**: TC39 Stage 3, near Stage 4 promotion.
- **Native runtimes**: Firefox 139+ ships natively. V8 / Chrome / Node
  / Bun still polyfill-only.
- **Polyfill**: `@js-temporal/polyfill` is the canonical implementation,
  ~30 KB minified+gzipped. API is stable and matches the spec.

This means: write code against `globalThis.Temporal` (typed via the
polyfill's `.d.ts`), import the polyfill once at app entry, and when V8
/ Bun ship native Temporal we delete the import — no other code changes.

## Architecture

### Boundaries

```
+---------------------+         +--------------------+        +--------------------+
|   Postgres TIMESTAMP|  Date   |  Drizzle row       | Date   |   API handler      |
+---------------------+ ──────► +--------------------+ ──────►+--------------------+
                                                                       │
                                                                       │ ISO 8601
                                                                       ▼
+---------------------+ Temporal +--------------------+ ISO  +--------------------+
|   React component   | ◄─────── |   tanstack-form    |◄───── |   oRPC response   |
+---------------------+          +--------------------+       +--------------------+
```

Three boundaries to plumb, each with a small adapter:

1. **DB → handler**: Drizzle returns `Date`; handlers convert to
   `Temporal.Instant` before returning. Until drizzle-orm has native
   Temporal column types upstream (item 2 below), this conversion lives
   in our own `serialize()` helper at the handler boundary.
2. **Handler → wire**: oRPC serializes Temporal types to ISO strings.
   Until `@orpc/server` has a built-in `Temporal` JSON adapter (item 4
   below), our zod schemas use `z.string().datetime().transform()` and
   the contract output type is the inferred Temporal type.
3. **Wire → client**: oRPC client receives ISO strings; the same
   transform reverses to Temporal on the client. End-to-end inference
   works because both ends share the same Zod schema in
   `packages/api/.../contract.ts`.

### `lib/time.ts` (new, single source for the polyfill + helpers)

```ts
// apps/web/src/shared/lib/time.ts
import "@js-temporal/polyfill"; // installs the global

export type { Temporal } from "@js-temporal/polyfill";

/** Drizzle/wire Date → Temporal.Instant. */
export const fromDate = (d: Date): Temporal.Instant =>
  Temporal.Instant.fromEpochMilliseconds(d.getTime());

/** Temporal.Instant → Date (for legacy boundaries). */
export const toDate = (i: Temporal.Instant): Date =>
  new Date(Number(i.epochMilliseconds));

/** ISO string from the wire → Temporal.Instant. */
export const fromIso = (iso: string): Temporal.Instant =>
  Temporal.Instant.from(iso);

/** Locale-aware "5 minutes ago" using Intl.RelativeTimeFormat. */
export function toRelative(
  when: Temporal.Instant,
  locale = "en",
  reference = Temporal.Now.instant(),
): string {
  const diffMs = Number(reference.epochMilliseconds - when.epochMilliseconds);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(diffMs);
  if (abs < 60_000) return rtf.format(Math.round(-diffMs / 1000), "second");
  if (abs < 3_600_000) return rtf.format(Math.round(-diffMs / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(-diffMs / 3_600_000), "hour");
  return rtf.format(Math.round(-diffMs / 86_400_000), "day");
}
```

`packages/api` gets its own `packages/api/src/shared/time.ts` mirror so
the API can run without depending on the web package.

### Zod schema convention

Until upstream `zod` ships Temporal validators, we define our own once:

```ts
// packages/api/src/shared/zod-temporal.ts
import * as z from "zod";
import { fromIso } from "./time";

export const zInstant = z
  .string()
  .datetime({ offset: true })
  .transform((s) => fromIso(s));

export const zPlainDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((s) => Temporal.PlainDate.from(s));
```

Contract files import `zInstant` instead of `z.date()`. The wire stays
ISO. Inference produces `Temporal.Instant` on both ends of the contract.

## Migration phases (in-codebase)

### Phase 0 — Foundations (1 PR)

Files: `apps/web/src/shared/lib/time.ts` (new),
`packages/api/src/shared/time.ts` (new),
`packages/api/src/shared/zod-temporal.ts` (new),
`apps/web/package.json` + `packages/api/package.json` (add
`@js-temporal/polyfill`).

Acceptance: helpers exist, polyfill is imported once at each entry
(`apps/web/src/main.tsx`, `apps/server/src/index.ts` if present).

### Phase 1 — Display layer (1 PR, low risk)

Replace all `toLocaleString` / ad-hoc `formatRelative` callsites with
`toRelative` / `Temporal.PlainDateTime.from(...).toLocaleString(...)`.

Callsites identified by `grep -r "toLocaleString\|formatRelative" apps/web/src`:

- `routes/_app/$orgSlug/servers.tsx` — `formatRelative(server.joinedAt)`
- `routes/_app/$orgSlug/$projectSlug/graph/$resourceId.tsx` — any
  timestamp display
- `features/projects/components/new-resource/steps/review.tsx` — none
  currently, but anywhere a date renders
- `features/projects/components/graph/resource-node.tsx` — none yet

Each callsite converts `Date | string` → `Temporal.Instant` at entry,
then formats. Wire format unchanged.

Acceptance: every visible timestamp goes through `lib/time.ts`. No new
`Date` math added in display code.

### Phase 2 — Form layer (1 PR per feature, batch)

Tanstack-form field types switch from `Date` to the appropriate
Temporal type (`PlainDate` for date pickers, `ZonedDateTime` for
timestamps with TZ, `Duration` for "max runtime" fields). Conversion to
`Date` happens at submit boundary for now (until handlers consume
Temporal directly in Phase 3).

Touched: every form schema in `apps/web/src/features/**/schema.ts` and
`new-resource/schema.ts`.

Acceptance: form state holds Temporal types. Submit handler converts to
Date for the legacy wire boundary.

### Phase 3 — Contract layer (1 PR per router)

Replace `z.date()` / `createSelectSchema().extend()` Date fields with
`zInstant` / `zPlainDate`. The contract's inferred output becomes
`Temporal.Instant`. oRPC continues to serialize ISO on the wire — the
transform happens in the Zod parse.

Touched: every contract file under `packages/api/src/routers/*/contract.ts`.

Acceptance: `serverSchema`, `envSchema`, `projectSchema`, etc. all
expose Temporal types. Contract tests still pass.

### Phase 4 — DB driver layer (1 PR, big diff but mechanical)

Once upstream `drizzle-orm` lands a Temporal column type (item 2), swap
every `timestamp(...)` column for `timestamp(..., { mode: 'temporal' })`
or whatever the upstream API ends up being. Until then, the conversion
lives in the handler boundary (a `serialize()` helper that walks the row
once).

Acceptance: handlers never see `Date` again. App code is Temporal-only
end-to-end.

## Upstream contribution plan

Each library targeted with a focused PR; sequencing matters because
some depend on others. Goal: every PR is small enough to merge on its
own merits, doesn't require a coordinated release across libraries, and
ships behind an opt-in flag where possible.

### 1. `colinhacks/zod` — `z.temporal.*` validators

Repo: <https://github.com/colinhacks/zod>

Proposal: add `z.instant()`, `z.plainDate()`, `z.plainDateTime()`,
`z.zonedDateTime()`, `z.duration()` constructors. Each accepts either
an ISO string or an existing Temporal instance and validates against
`Temporal.X.from()` (which throws on malformed input — Zod wraps the
throw into a `ZodIssue`).

Why first: every other upstream PR is cleaner if Zod has native
support. Without it, we ship `zod-temporal.ts` in our codebase and
maintain it.

Risks: zod maintainer may want to wait for Temporal Stage 4 / native
runtime support before adding it to the core surface. Plan B is a
separate `@zod/temporal` package or a published recipe. Open an RFC
issue first; don't drop a 1000-line PR cold.

PR size estimate: ~400 LOC + tests.

### 2. `drizzle-team/drizzle-orm` — Temporal column types

Repo: <https://github.com/drizzle-team/drizzle-orm>

Proposal: extend `timestamp` / `timestamptz` / `date` column builders
with a `mode` option that returns Temporal instead of Date:

```ts
timestamp("created_at", { mode: "temporal" }) // returns Temporal.Instant
date("dob", { mode: "temporal" })             // returns Temporal.PlainDate
```

`mode: "string"` already exists in drizzle; this slots in next to it
as `mode: "temporal"`. The driver still gets a Date / Postgres string;
the column type converts at the boundary.

Why next: this is what makes Phase 4 possible without per-handler
adapters. drizzle-orm has good test infrastructure, so this is the
most tractable upstream change after Zod.

Risks: drizzle-team has historically been conservative about adding new
dependencies. The polyfill would be a peerDependency (not bundled).
This needs an RFC + maintainer buy-in before code.

PR size estimate: ~600 LOC across Postgres/MySQL/SQLite column types +
docs + tests.

### 3. `drizzle-team/drizzle-zod` — Temporal schema emission

Repo: <https://github.com/drizzle-team/drizzle-zod>

Proposal: when a column declares `mode: "temporal"` (item 2), have
`createSelectSchema` / `createInsertSchema` emit `z.temporal.instant()`
/ `z.temporal.plainDate()` (item 1) instead of `z.date()`.

Why ordering: depends on items 1 + 2. Once both ship, this is a 50-line
PR to map the new column flag to the new Zod constructor.

PR size estimate: ~150 LOC.

### 4. `unnoq/orpc` — JSON adapter for Temporal types

Repo: <https://github.com/unnoq/orpc>

Proposal: register Temporal types in oRPC's JSON serializer so
`Temporal.Instant` round-trips through the wire as an ISO string
without requiring every contract to do `z.string().transform()`. This is
the same shape as the existing Date serialization, just for Temporal.

Wire format remains ISO 8601 — no breaking change.

Why later: once the codebase has Temporal in contracts (Phase 3),
removing the per-schema `.transform()` boilerplate is a quality-of-life
win, not a blocker.

PR size estimate: ~200 LOC including tests.

### 5. `tanstack/form` — Temporal-aware field types

Repo: <https://github.com/TanStack/form>

Proposal: ensure `Field<T>` infers correctly for Temporal types and
that the form's serialization (for tools like devtools) doesn't choke
on Temporal instances. Likely a small types-only PR — Tanstack Form is
mostly type-passthrough so this might be docs + a couple of test
fixtures.

Why lowest priority: forms work with any value type; Temporal already
flows through as long as you don't introspect with `Object.keys` /
`JSON.stringify`. The PR is more about validating the path than
unlocking anything.

PR size estimate: ~50 LOC + a Temporal example in the docs.

### Sequencing summary

```
zod (item 1) ───┬──► drizzle-orm (item 2) ───► drizzle-zod (item 3)
                │
                └──► orpc (item 4)
                                                 tanstack/form (item 5)
```

Items 1, 2, and 5 can be in flight in parallel; 3 and 4 depend on 1; 3
also depends on 2.

## Testing strategy

- Each phase ships with a small set of contract tests that round-trip
  a Temporal value: `Temporal.Instant.from(iso)` → wire → client →
  `Temporal.Instant`. Compare via `.equals()`.
- DB integration: a single migration test inserts a `Date`, reads it
  back, confirms it converts to the expected `Temporal.Instant`.
- No "before/after Temporal" snapshot tests — the behavior we care
  about (wire format, displayed strings, calendar math) is what gets
  asserted directly.

## Rollback plan

Every phase is independently reversible:

- Phase 0: remove the polyfill import + helpers. No behavior changes
  remain (no callers).
- Phase 1: revert the display callsites back to `toLocaleString`. The
  helpers stay (no harm).
- Phase 2: form fields revert to `Date`. Submit handler stops
  converting.
- Phase 3: contract `zInstant` swaps back to `z.date()`. Wire format
  unchanged either way.
- Phase 4: revert the column-type swap; handler `serialize()` helper
  reappears.

The polyfill itself can stay through any rollback — it has no runtime
impact unless code references `Temporal`.

## Open decisions

- **Time zone defaulting**: when a column stores a UTC instant
  (`timestamptz`), do we surface it as `Temporal.Instant` (no implicit
  TZ) or as `Temporal.ZonedDateTime` in the user's TZ? Recommended:
  `Instant` everywhere; resolve to ZonedDateTime only at the display
  layer using `Intl.DateTimeFormat`. Less ambiguity, no implicit
  global "current TZ".
- **Polyfill placement**: import once at the app entry vs lazy import
  per feature. Recommended: single import, polyfill is small (~30 KB)
  and unconditional simplifies reasoning.
- **Should we drop date-fns up front**: we don't currently depend on
  it. Add an ESLint rule banning `date-fns` imports as part of Phase
  0 to keep future work from reaching for it.

## What stays untouched

- ISO 8601 on the wire — every existing client keeps working.
- Drizzle migrations and DB schema — `timestamp(...)` columns don't
  change at the Postgres level.
- Public API URLs and shapes — the migration is type-level + adapter
  -level only.
