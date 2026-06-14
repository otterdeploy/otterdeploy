# Investigation: manual types in `packages/api/src/routers/service/inputs.ts`

**Question:** Why does this file hand-write a pile of TS interfaces instead of
deriving Zod schemas from the DB tables and using `z.infer` for the types?

**Short answer:** It's an outlier. The shapes are duplicated *three* times
(contract zod → manual interfaces → db columns), and the file's stated
justification ("brands are lossy") doesn't actually hold for the contract input
schemas. The duplication can largely be collapsed.

---

## What exists today (three parallel definitions of the same shape)

1. **Wire / validation source of truth** — `contract.ts`
   - `createServiceInput`, `updateServiceInput`, `servicePortInputSchema`,
     plus inline `restart` / `healthcheck` / `resources` zod objects.
   - These are the runtime validators oRPC actually enforces.

2. **Handler input types** — `inputs.ts` (the file in question)
   - `CreateServiceInput`, `UpdateServiceInput`, `RestartInput`,
     `HealthcheckInput`, `ResourcesInput`, `PortInput`, `ResourceRef`,
     `ProjectRef`.
   - Hand-written interfaces that *restate the same shape* as the zod schemas
     above (with brands + an extra `organizationId`).
   - Plus the `toCreateRecordPayload` / `toUpdateRecordPatch` adapters that
     manually fan each field out to the DB column payload.

3. **Persistence source of truth** — `packages/db/src/schema/project.ts`
   (`serviceResource` table)
   - `restartCondition`, `restartMaxAttempts`, `healthcheckCmd`, `cpuLimit`,
     etc. The adapters in (2) map (1)→(3) by hand.

So a field like `restart.maxAttempts` is declared in `contract.ts` (zod),
again in `inputs.ts` (`RestartInput`), and mapped to `restartMaxAttempts` in
both the DB schema and the adapter. Adding one knob touches ~4 places.

## The codebase already does the derive-from-zod thing elsewhere

`drizzle-zod` is a dependency (`packages/api/package.json`) and
`createSelectSchema` is used in:

- `routers/project/contract/project.ts`
- `routers/server/contract.ts`
- `routers/env/contract.ts`
- `routers/backups/contract.ts`
- `routers/project/contract/proxy.ts`

The **service** router is the one that hand-rolls everything. This is a
consistency gap, not a deliberate architectural choice.

## The file's own justification is partly inaccurate

`inputs.ts` header says the manual types exist because they're *"lossy in the
brand types, which the handler boundary casts in."*

That concern is real for **`createSelectSchema`** (drizzle-zod 1.0-beta drops
`$type<…>` brands on `text` columns — documented in `project.ts:14-20`). But it
does **not** apply to the hand-authored **contract input** schemas here:

- `projectIdField` / `resourceIdField` = `zId(prefix)` (`shared/id.ts:136`),
  which `.transform((s) => s as Id<P>)` — i.e. `z.infer` of these fields is the
  **branded** `ProjectId` / `ResourceId`, not a bare `string`.

So `z.infer<typeof createServiceInput>` would already carry the brands. The
manual interfaces aren't buying brand-safety that `z.infer` lacks.

## What's genuinely different about the handler input type

Two real reasons the handler type isn't *identical* to the contract input —
but neither requires re-declaring the whole shape:

1. **`organizationId` is injected server-side** from `context.activeOrganizationId`
   (`index.ts:85`), so it's not part of the wire input. The handler type =
   contract input **+ `organizationId`**.
2. A few create-only fields aren't in the public contract (e.g.
   `skipBuildBindingCheck`, set by the manifest reconciler;
   `sourceSubdir`/`preDeploy`/`buildConfig` appear in `inputs.ts` but not in
   `createServiceInput`). These are internal-caller extensions layered on top
   of the wire shape.

This is exactly what intersection types are for.

## Recommended direction

**Collapse layer (2) onto layer (1).** Keep the zod schemas in `contract.ts` as
the single shape source; derive the handler types:

```ts
// inputs.ts
import type { createServiceInput, updateServiceInput } from "./contract";

export type CreateServiceInput = z.infer<typeof createServiceInput> & {
  organizationId: OrganizationId;
  // internal-caller-only extensions not on the wire contract:
  skipBuildBindingCheck?: boolean;
  sourceSubdir?: string | null;
  preDeploy?: string[] | null;
  buildConfig?: BuildConfigInput | null;
};

export type UpdateServiceInput = z.infer<typeof updateServiceInput> & {
  organizationId: OrganizationId;
  preDeploy?: string[] | null;
  buildConfig?: BuildConfigInput | null;
};
```

(If the internal-only fields should also be validated, add them to the zod
schemas as `.optional()` and drop them from the intersection — better still.)

This deletes `RestartInput` / `HealthcheckInput` / `ResourcesInput` /
`PortInput` and removes the drift risk between the validator and the type.

### On "derive from the DB table" specifically

Deriving the *input* from the table (`createInsertSchema(serviceResource)`) is
**not** a clean fit here, because the wire/input shape deliberately diverges
from the column shape:

- nested objects (`restart`, `healthcheck`, `resources`) vs flat columns
  (`restartCondition`, `healthcheckCmd`, `cpuLimit`…);
- `cpuLimit` is `number` on the wire but `numeric`→`string` in the column
  (note the `.toString()` in the adapters);
- the table carries derived/server-set columns (`serviceName`, `networkName`,
  `internalHostname`, `forceUpdateCounter`, `status`, timestamps) that must
  never come from the client.

So the adapters (`toCreateRecordPayload` / `toUpdateRecordPatch`) are doing real
work — that nesting→flat + unit translation is legitimate and should stay. The
redundant part is the **interfaces**, not the adapters.

Where derive-from-table *would* pay off is the **output** `serviceSchema` in
`contract.ts` (currently fully hand-written, lines 59-84) — that mirrors the
column shape much more closely and is the better candidate for
`createSelectSchema(serviceResource).extend({...})`, matching how
`project`/`server`/`env` already do it. Watch the same brand caveat noted in
`project.ts:14-20` (re-`.extend` id fields with the typed `*IdField`).

## Suggested scope if acting on this

- **Low-risk, high-value:** replace the manual interfaces in `inputs.ts` with
  `z.infer` intersections (keep the adapters). Pure type change.
- **Medium:** migrate `serviceSchema` output to `createSelectSchema`, aligning
  with the other routers.
- **Leave alone:** the nesting→flat adapters and the `numeric` `.toString()`
  handling — these encode real impedance between wire and DB and aren't
  "boilerplate to delete."
