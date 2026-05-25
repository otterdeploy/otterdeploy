# Project secrets rework — design

**Status:** draft — awaiting review
**Author:** Jefferson (with Claude)
**Replaces:** the mocked `VariablesTabBody` inside the resource detail panel

## Why

The current secrets surface is the `Variables` tab on the resource detail panel,
backed by two hardcoded constants (`PROJECT_VARS`, `SERVICE_VARS`) in
`$resourceId.tsx`. Nothing is persisted, nothing is per-environment, nothing
is shareable, and nothing is wired to the existing `service.env.*` procedures.

We're rebuilding this into a project-level secrets surface that matches the
operator workflow Doppler / Infisical / Vercel established:

- **Matrix overview** across environments (production / staging / preview) so
  a missing secret in one env is visible at a glance.
- **Per-environment detail** with row-level edit / delete / copy.
- **Bulk paste** for `.env` files — the highest-leverage operator action.
- **Project-scoped secrets** that services explicitly subscribe to, plus the
  existing `${{Resource.VAR}}` template syntax for service-to-service refs.

## Decisions locked in via brainstorm

1. **Surface scope** — new project-level page at
   `/$orgSlug/$projectSlug/secrets`. The resource Variables tab becomes a
   filtered, read-only-ish view that links back here.
2. **Sharing model** — *both* (1) explicit per-service subscription to
   project-scoped vars, and (2) inline `${{Resource.VAR}}` references
   (already wired server-side).
3. **Encryption at rest** — out of scope for v1. Plaintext in Postgres; rely
   on disk encryption. A `valueEncrypted` migration can come later without
   API breakage.
4. **v1 cut** — Matrix overview, per-env detail, bulk paste, add / edit /
   delete, project vs service scope, masking. Defer: Sync tab, audit log,
   commit history, secret rotation.

## Data model

Two new tables. Both store plaintext `value` for v1.

```sql
-- Project-scoped secret. One row per (projectId, environmentId, key).
-- Services subscribe to these explicitly via projectEnvSubscription.
projectEnvVar (
  id                pe_xxx              PK
  projectId         p_xxx               FK project (cascade)
  environmentId     env_xxx             FK environment (cascade)
  key               text                NOT NULL  -- /^[A-Z_][A-Z0-9_]*$/
  value             text                NOT NULL  -- plaintext for v1
  isSecret          boolean             NOT NULL DEFAULT true  -- drives masking
  createdAt         timestamp
  updatedAt         timestamp
  UNIQUE (projectId, environmentId, key)
)

-- Explicit per-service subscription to a project var. Without a row here the
-- service does NOT receive the var, even if it exists at the project level.
-- This is the "I like option 2 + 3" choice — sharing is opt-in per service.
projectEnvSubscription (
  id                pes_xxx             PK
  serviceResourceId r_xxx               FK service_resource (cascade)
  projectEnvKey     text                NOT NULL  -- key in projectEnvVar
  createdAt         timestamp
  UNIQUE (serviceResourceId, projectEnvKey)
)
```

`serviceEnvVar` (existing) **gets an `environmentId` column** so service-only
vars can differ across envs:

```sql
ALTER TABLE service_env_var
  ADD COLUMN environment_id text NOT NULL REFERENCES environment(id),
  ADD COLUMN is_secret boolean NOT NULL DEFAULT false,
  DROP CONSTRAINT service_env_var_unique,
  ADD UNIQUE (service_resource_id, environment_id, key);
```

Migration shim: backfill existing rows with the project's "production" env.

### Resolution order at deploy time

When the swarm task is composed for a service in a given environment:

1. Start with empty env map.
2. For every `projectEnvSubscription` row on the service:
   - Look up `projectEnvVar` by `(projectId, environmentId, key)`. Add to map.
3. Overlay every `serviceEnvVar` row matching `(serviceResourceId, environmentId)`.
   Per-service value wins over inherited project value with the same key.
4. Run the existing `${{Resource.VAR}}` template expansion on values (handles
   the service-to-service ref case — REF_MISSING / REF_CYCLE already work).

## API

New router: `packages/api/src/routers/projectSecrets/`.

```ts
project.secrets.list({ projectId })
  -> Array<{
       key,
       perEnv: Record<environmentId, { value: string | null; isSecret: boolean; status: "set" | "empty" | "missing" }>
     }>
  // Drives the matrix overview. "missing" = key exists in another env but not this one.

project.secrets.listForEnv({ projectId, environmentId })
  -> Array<projectEnvVarRow>
  // Drives the per-env detail page.

project.secrets.set({ projectId, environmentId, key, value, isSecret })
  -> projectEnvVarRow
  // Upsert. Validates key regex.

project.secrets.unset({ projectId, environmentId, key })
  -> { ok }

project.secrets.bulkSet({ projectId, environmentIds: [...], dotenv: string, markSecret: boolean })
  -> { applied: number, errors: Array<{ line, message }> }
  // Parse .env (KEY=value, # comments ok), apply to every selected environmentId.

project.secrets.bulkExport({ projectId, environmentId })
  -> string  // .env-formatted

project.secrets.subscribe({ serviceResourceId, keys: string[] })
  -> Array<subscriptionRow>
  // Replaces the service's subscription set with `keys`. Validates each key
  // exists at the project level.
```

The existing `service.env.{list,set,unset,bulkSet}` procedures stay and
operate on `serviceEnvVar` — but `setEnvInput` / `bulkEnvInput` gain an
`environmentId` parameter.

## UI

### New page: `/$orgSlug/$projectSlug/secrets`

```
┌──────────────────────────────────────────────────────────────────────┐
│  [ Overview ]  [ Production 17 ]  [ Staging 17 ]  [ Preview ]  …    │
├──────────────────────────────────────────────────────────────────────┤
│  Project Overview     Filters  [ search ]   + Add Secret            │
│                                                                      │
│  NAME                       PRODUCTION   STAGING    PREVIEW          │
│  ADMIN_ALLOWED_EMAILS         ○            ○          ○              │
│  APPLE_APP_BUNDLE_ID          ✓            ✗          ✗              │
│  DATABASE_URL                 ✓            ✓          ✓              │
│  …                                                                   │
│                                                                      │
│             [ Explore → ]    [ Explore → ]    [ Explore → ]          │
└──────────────────────────────────────────────────────────────────────┘
```

Status glyphs match the screenshots:
- ✓ green: set
- ✗ red: missing in this env but exists elsewhere
- ○ amber: present-but-empty value
- — muted: not yet declared in this env

Per-env tab (`Production` / `Staging` / `Preview`):

```
┌──────────────────────────────────────────────────────────────────────┐
│  [ search ]  Filters         ↓ export   👁 reveal   ⌗ Bulk edit   + Add │
├──────────────────────────────────────────────────────────────────────┤
│  ☐  KEY                       VALUE                                  │
│  ☐  ADMIN_ALLOWED_EMAILS      EMPTY                                  │
│  ☐  APPLE_APP_BUNDLE_ID       ••••••••••••••••     [hover: actions]  │
│  ☐  DATABASE_URL              ••••••••••••••••                       │
│  …                                                                   │
│  [ drag-drop .env / .json / .csv / .yml ]   [ Paste Secrets ]        │
└──────────────────────────────────────────────────────────────────────┘
```

Per-row hover actions: copy, edit-inline, toggle-secret-mask, duplicate-to-env,
sync-from-other-env, upload-value, delete. Inline edit collapses the value
cell into an `Input`; commit on `Enter`, cancel on `Esc`. No modal for the
common edit path.

Bulk edit modal (matches Image #55):

```
┌─────────────────────────────────────────────────────────────────────┐
│  Bulk edit · production       Paste a .env, or edit inline   ✕      │
├─────────────────────────────────────────────────────────────────────┤
│  .env format · # comments ok · KEY=value      Paste from clipboard  │
│                                                                     │
│  [ big textarea with parsed/highlighted lines ]    APPLY TO         │
│                                                     ☑ production    │
│                                                     ☐ staging       │
│                                                     ☐ preview       │
│                                                                     │
│                                                     PREVIEW         │
│                                                     17 vars parsed  │
│                                                     7 marked secret │
│                                                                     │
│                                                     DETECTED        │
│                                                     ADMIN_ALLOWED…  │
│                                                     APPLE_KEY_ID    │
│                                                     …               │
│                                                                     │
│  Hot-reload to all replicas in production    [Cancel]  [Apply 17 →] │
└─────────────────────────────────────────────────────────────────────┘
```

Parser is `KEY=value` per line, `#` comments stripped, `KEY=""` allowed,
unknown chars surface as inline errors next to the bad line.

### Resource panel: Variables tab (simplified)

The tab inside the resource detail panel becomes a two-section view:

1. **Subscribed from project** — list of `projectEnvVar` rows the service is
   currently subscribed to, with key/value/scope and a `Manage subscriptions`
   button that opens a key-picker drawer (multi-select against
   `project.secrets.list`).
2. **Service-only** — `serviceEnvVar` rows for the current env, inline edit
   same as the project page.

Both sections show a small `Open project secrets →` link in the header that
navigates to the new page filtered to the relevant env.

## Routes added

```
/$orgSlug/$projectSlug/secrets               → layout (env tabs strip)
/$orgSlug/$projectSlug/secrets/              → ProjectOverview matrix
/$orgSlug/$projectSlug/secrets/$envSlug      → per-env detail
```

Search param: `?q=...` for the search box. State for "reveal" lives in
local state — never persisted.

## File layout

```
packages/db/src/schema/project.ts
  + projectEnvVar
  + projectEnvSubscription
  ~ serviceEnvVar  (add environmentId, isSecret; new unique index)
packages/db/migrations/0028_project_secrets.sql   (manual: ALTER + backfill)

packages/api/src/routers/project/
  + secrets/                                       (new sub-router)
    contract.ts
    queries.ts
    handlers.ts
    parse-dotenv.ts
    index.ts
  ~ index.ts                                        (mount secrets sub-router)
  ~ service/contract.ts                             (add environmentId to env inputs)
  ~ service/handlers.ts                             (env-scoped reads + resolution)

apps/web/src/features/secrets/                     (new feature)
  data/
    secrets.ts                                      (project + per-env collections)
  components/
    secrets-overview.tsx                            (matrix)
    secrets-env-detail.tsx                          (per-env table)
    bulk-edit-dialog.tsx                            (paste modal)
    add-secret-dialog.tsx
    inline-value-editor.tsx
    masked-value.tsx
    subscriptions-drawer.tsx                        (per-service picker)

apps/web/src/routes/_app/$orgSlug/$projectSlug/secrets/
  layout.tsx                                        (env tabs strip)
  index.tsx                                         (overview matrix)
  $envSlug.tsx                                      (per-env detail)

apps/web/src/routes/_app/$orgSlug/$projectSlug/graph/$resourceId.tsx
  ~ VariablesTabBody                                (real data + subscriptions)
```

## Validation & guardrails

- Key regex: `/^[A-Z_][A-Z0-9_]*$/` (matches existing `envKeyRegex`).
- Value size cap: 64 KiB per secret. Larger values reject with INVALID_INPUT.
- Bulk apply is transactional per-environment: all-or-nothing for that env.
- Deleting a `projectEnvVar` cascades to subscriptions; the operator gets a
  confirmation listing affected services. Subscriptions don't cascade-delete
  when a service is removed — the service row's `ON DELETE CASCADE` handles it.

## Out of scope (v1)

- Encryption at rest (column or external KMS)
- Audit log / commit history (the "3 Commits" indicator)
- Sync tab — external sources (Vault, 1Password, AWS Secrets Manager)
- Secret rotation flows
- Per-secret access policy (RBAC beyond the existing org gate)
- Folders / paths (the screenshots' folder icon)

## Build order

1. Schema migration + drizzle types
2. `project.secrets.*` router (list, listForEnv, set, unset)
3. Project page: per-env detail (the most-used surface)
4. Bulk paste modal + dotenv parser
5. Add-secret dialog + inline edit
6. Matrix overview tab
7. `service.env.*` environmentId migration + resolution at deploy time
8. Resource Variables tab simplification + subscriptions drawer
9. Wire the Postgres provisioner to inject subscribed project vars

Each step ships as its own PR-sized change; we sanity-check between them.

## Risks & open questions

- **Migration of existing `serviceEnvVar` rows.** Today they're project-flat.
  Backfill maps them all to the project's `production` env. Operators with
  staging/preview values they set manually would need to copy across after
  upgrade. Acceptable given no real usage yet.
- **Subscription UX vs reference UX.** Two ways to share is power but can be
  confusing. Mitigation: subscriptions show as a separate "Inherited" group
  in the service Variables tab; references show inline in their consuming
  var value with a syntax hint.
- **Empty-value semantics.** Doppler treats `KEY=` as set-but-empty; Vercel
  treats it as missing. We follow Doppler — `KEY=` is "set, value is empty
  string" (amber ○). Truly missing is "no row" (red ✗ when present in another
  env, muted — otherwise).
