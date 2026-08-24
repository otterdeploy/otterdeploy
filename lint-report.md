# Lint report — repo root `bun run lint` (oxlint --type-aware)

**1 error(s), 252 warnings** across 107 files.

## Errors

### typescript-eslint(consistent-type-assertions) — 1
- `apps/web/src/features/projects/components/new-resource/steps/builder.tsx` — Do not use any type assertions.

## Warnings (grouped by rule, most frequent first)

### typescript-eslint(no-deprecated) — 69
- `apps/web/src/features/projects/components/new-resource/steps/source.tsx` ×5 — `useStore` is deprecated.
- `apps/web/src/features/projects/components/new-resource/compose-detect.tsx` ×4 — `useStore` is deprecated.
- `apps/web/src/features/projects/components/new-resource/compose-wizard-fields.tsx` ×4 — `useStore` is deprecated.
- `apps/web/src/features/projects/components/new-resource/compose-wizard.tsx` ×4 — `useStore` is deprecated.
- `apps/web/src/features/projects/components/new-resource/steps/resources.tsx` ×4 — `useStore` is deprecated.
- `packages/jobs/src/define.ts` ×3 — `ZodTypeAny` is deprecated. Use z.ZodType (without generics) instead.
- `apps/web/src/features/projects/components/new-resource/steps/builder.tsx` ×3 — `useStore` is deprecated.
- `apps/web/src/features/projects/components/new-resource/steps/image.tsx` ×3 — `useStore` is deprecated.
- `apps/web/src/features/projects/components/new-resource/steps/resources-placement.tsx` ×3 — `useStore` is deprecated.
- `apps/web/src/features/projects/components/new-resource/wizard-form.ts` ×3 — `useStore` is deprecated.
- `apps/web/src/shared/components/data-grid/data-grid-cell-variants.tsx` ×3 — `FormEvent` is deprecated. FormEvent doesn't actually exist.
- `apps/web/src/features/projects/components/new-resource/steps/version.tsx` ×2 — `useStore` is deprecated.
- `apps/web/src/features/projects/components/new-resource/use-repo-detection.ts` ×2 — `useStore` is deprecated.
- `apps/web/src/features/projects/components/new-resource/steps/networking-views.tsx` ×2 — `useStore` is deprecated.
- `apps/web/src/features/projects/components/new-resource/steps/resources-size.tsx` ×2 — `useStore` is deprecated.
- `apps/web/src/features/projects/components/new-resource/steps/variables.tsx` ×2 — `useStore` is deprecated.
- `packages/api/src/routers/git/contract.ts` ×2 — `url` is deprecated. Use `z.url()` instead.
- `packages/api/src/routers/webhooks/contract.ts` ×2 — `url` is deprecated. Use `z.url()` instead.
- `apps/web/src/features/projects/components/new-resource/compose-extra-files.tsx` — `useStore` is deprecated.
- `apps/web/src/features/projects/components/new-resource/compose-name-field.tsx` — `useStore` is deprecated.
- `apps/web/src/features/projects/components/new-resource/compose-wizard-body.tsx` — `useStore` is deprecated.
- `apps/web/src/features/projects/components/new-resource/steps/kind.tsx` — `useStore` is deprecated.
- `apps/web/src/features/projects/components/new-resource/steps/postgres-extensions-section.tsx` — `useStore` is deprecated.
- `apps/web/src/features/projects/components/new-resource/steps/review.tsx` — `useStore` is deprecated.
- `apps/web/src/features/projects/components/create-project-dialog.tsx` — `useStore` is deprecated.
- `apps/web/src/features/registries/registry-dialog.tsx` — `useStore` is deprecated.
- `apps/web/src/features/backups/backup-now-dialog.tsx` — `useStore` is deprecated.
- `apps/web/src/routes/_app/$orgSlug/_shell/audit.tsx` — `useStore` is deprecated.
- `apps/web/src/routes/_app/$orgSlug/_shell/$projectSlug/settings.tsx` — `useStore` is deprecated.
- `apps/web/src/features/resources/components/service/tabs/settings/build-card-forms.tsx` — `useStore` is deprecated.
- `apps/web/src/features/resources/components/service/tabs/settings/health-check-card.tsx` — `useStore` is deprecated.
- `apps/web/src/features/resources/components/service/tabs/settings/scaling-card.tsx` — `useStore` is deprecated.
- `apps/web/src/features/resources/components/service/tabs/settings/source-card.tsx` — `useStore` is deprecated.
- `packages/api/src/edge-logs/event-parse.ts` — `passthrough` is deprecated. Use `z.looseObject()` or `.loose()` instead.

### typescript-eslint(await-thenable) — 32
- `apps/builder/src/__tests__/archive-extract.test.ts` ×19 — Unexpected `await` of a non-Promise (non-"Thenable") value.
- `packages/shared/src/__tests__/egress-policy.test.ts` ×12 — Unexpected `await` of a non-Promise (non-"Thenable") value.
- `apps/server/src/bootstrap.ts` — Unexpected `await` of a non-Promise (non-"Thenable") value.

### eslint(no-unused-vars) — 28
- `apps/web/src/features/certificates/cas-table.tsx` ×10 — Identifier 'Delete02Icon' is imported but never used.
- `apps/web/src/features/shell/nav-manifest.ts` ×7 — Identifier 'Alert01Icon' is imported but never used.
- `apps/web/src/features/updates/components/update-progress-parts.tsx` ×6 — Identifier 'useEffect' is imported but never used.
- `apps/web/src/routes/_app/$orgSlug/_shell/$projectSlug/deployments.tsx` — Identifier 'useSearch' is imported but never used.
- `apps/web/src/routes/_app/$orgSlug/_shell/$projectSlug/graph/layout.tsx` — Identifier 'useSearch' is imported but never used.
- `apps/web/src/features/tour/tour-provider.tsx` — Identifier 'hasSeenTour' is imported but never used.
- `apps/web/src/routes/_app/$orgSlug/_shell/$projectSlug/metrics.tsx` — Identifier 'useSearch' is imported but never used.
- `apps/web/src/shared/components/domains/dns-records-dialog.tsx` — Identifier 'useState' is imported but never used.

### eslint-plugin-jsx-a11y(no-autofocus) — 21
- `apps/web/src/routes/device.tsx` — The `autoFocus` attribute is found here, which can cause usability issues for sighted and non-sighted users.
- `apps/web/src/features/projects/components/new-resource/form-fields/variables-field-dotenv.tsx` — The `autoFocus` attribute is found here, which can cause usability issues for sighted and non-sighted users.
- `apps/web/src/features/volumes/create-volume-dialog.tsx` — The `autoFocus` attribute is found here, which can cause usability issues for sighted and non-sighted users.
- `apps/web/src/features/registries/registry-form-body.tsx` — The `autoFocus` attribute is found here, which can cause usability issues for sighted and non-sighted users.
- `apps/web/src/features/resources/components/service/tabs/variables/index.tsx` — The `autoFocus` attribute is found here, which can cause usability issues for sighted and non-sighted users.
- `apps/web/src/features/resources/components/service/tabs/settings/domain-add-form.tsx` — The `autoFocus` attribute is found here, which can cause usability issues for sighted and non-sighted users.
- `apps/web/src/features/projects/components/networking/route-access-guests.tsx` — The `autoFocus` attribute is found here, which can cause usability issues for sighted and non-sighted users.
- `apps/web/src/features/api-keys/create-key-dialog.tsx` — The `autoFocus` attribute is found here, which can cause usability issues for sighted and non-sighted users.
- `apps/web/src/features/projects/components/create-project-dialog.tsx` — The `autoFocus` attribute is found here, which can cause usability issues for sighted and non-sighted users.
- `apps/web/src/features/terminal/components/step-up-dialog.tsx` — The `autoFocus` attribute is found here, which can cause usability issues for sighted and non-sighted users.
- `apps/web/src/features/certificates/upload-ca-dialog.tsx` — The `autoFocus` attribute is found here, which can cause usability issues for sighted and non-sighted users.
- `apps/web/src/features/auth/components/enterprise-sso-sign-in.tsx` — The `autoFocus` attribute is found here, which can cause usability issues for sighted and non-sighted users.
- `apps/web/src/features/auth/components/two-factor-challenge.tsx` — The `autoFocus` attribute is found here, which can cause usability issues for sighted and non-sighted users.
- `apps/web/src/features/resources/components/postgres/tabs/data/components/snippet-tree-rows.tsx` — The `autoFocus` attribute is found here, which can cause usability issues for sighted and non-sighted users.
- `apps/web/src/features/ssh-keys/import-dialog.tsx` — The `autoFocus` attribute is found here, which can cause usability issues for sighted and non-sighted users.
- `apps/web/src/features/ssh-keys/generate-dialog.tsx` — The `autoFocus` attribute is found here, which can cause usability issues for sighted and non-sighted users.
- `apps/web/src/features/shell/components/environment-create-dialog.tsx` — The `autoFocus` attribute is found here, which can cause usability issues for sighted and non-sighted users.
- `apps/web/src/features/resources/components/postgres/tabs/variables/header-bar.tsx` — The `autoFocus` attribute is found here, which can cause usability issues for sighted and non-sighted users.
- `apps/web/src/features/resources/components/_shared/variables-editor/bulk-edit-dialog.tsx` — The `autoFocus` attribute is found here, which can cause usability issues for sighted and non-sighted users.
- `apps/web/src/shared/components/typed-confirm-dialog.tsx` — The `autoFocus` attribute is found here, which can cause usability issues for sighted and non-sighted users.
- `apps/web/src/shared/components/data-grid/data-grid-cell-variants.tsx` — The `autoFocus` attribute is found here, which can cause usability issues for sighted and non-sighted users.

### typescript-eslint(no-base-to-string) — 21
- `apps/server/src/handlers/deploy-protection/__tests__/wall-render.test.tsx` ×9 — '<AccessWall domain={DOMAIN} returnPath="/" orgAuthorizeUrl="/authorize" hasPin={hasPin} />' may use Object's 
- `packages/api/src/routers/firewall/decisions-read.ts` ×7 — 'v' will use Object's default stringification format ('[object Object]') when stringified.
- `apps/web/src/shared/components/data-grid/hooks/use-data-grid.ts` ×2 — 'value ?? ""' will use Object's default stringification format ('[object Object]') when stringified.
- `packages/jobs/src/delivery/channels.ts` — 'c.config.host ?? ""' may use Object's default stringification format ('[object Object]') when stringified.
- `apps/builder/src/errors.ts` — 'cause' will use Object's default stringification format ('[object Object]') when stringified.
- `packages/api/src/stack/compose/normalize.ts` — 'val' may use Object's default stringification format ('[object Object]') when stringified.

### typescript-eslint(no-floating-promises) — 18
- `packages/api/src/authz/__tests__/project-scope-guards.test.ts` ×12 — Promises must be awaited, add void operator to ignore.
- `packages/jobs/src/jobs/__tests__/webhook.test.ts` ×3 — Promises must be awaited, add void operator to ignore.
- `packages/jobs/src/__tests__/notification-inbox.test.ts` ×2 — Promises must be awaited, add void operator to ignore.
- `apps/server/src/handlers/auth/__tests__/device-origin.test.ts` — Promises must be awaited, add void operator to ignore.

### eslint-plugin-jsx-a11y(label-has-associated-control) — 14
- `apps/server/src/handlers/deploy-protection/ui/wall-forms.tsx` ×3 — A form label must be associated with a control.
- `apps/web/src/features/projects/components/new-resource/steps/source.tsx` ×2 — A form label must be associated with a control.
- `apps/web/src/shared/components/data-grid/data-grid-paste-dialog.tsx` ×2 — A form label must be associated with a control.
- `apps/web/src/features/projects/components/new-resource/wizard-chrome.tsx` — A form label must be associated with a control.
- `apps/web/src/features/account/password-card.tsx` — A form label must be associated with a control.
- `apps/web/src/features/projects/components/new-resource/compose-detect.tsx` — A form label must be associated with a control.
- `apps/web/src/features/resources/components/service/tabs/settings/health-check-fields.tsx` — A form label must be associated with a control.
- `apps/web/src/features/projects/components/new-resource/compose-wizard-fields.tsx` — A form label must be associated with a control.
- `apps/web/src/features/resources/components/postgres/tabs/data/studio-sql-toolbar.tsx` — A form label must have accessible text.
- `apps/web/src/shared/components/ui/label.tsx` — A form label must be associated with a control.

### eslint(no-console) — 11
- `packages/api/scripts/rotate-encryption-keys.ts` ×9 — Unexpected console statement.
- `test-infra/integration/bootstrap-fresh.postgres.test.ts` — Unexpected console statement.
- `test-infra/integration/bootstrap-upgrade.postgres.test.ts` — Unexpected console statement.

### eslint-plugin-jsx-a11y(click-events-have-key-events) — 4
- `apps/web/src/features/logs/components/log-columns.tsx` — Enforce a clickable non-interactive element has at least one keyboard event listener.
- `apps/web/src/features/certificates/managed-table.tsx` — Enforce a clickable non-interactive element has at least one keyboard event listener.
- `apps/web/src/features/backups/backup-row.tsx` — Enforce a clickable non-interactive element has at least one keyboard event listener.
- `apps/web/src/shared/components/ui/input-group.tsx` — Enforce a clickable non-interactive element has at least one keyboard event listener.

### eslint-plugin-unicorn(no-new-array) — 4
- `packages/api/src/edge-logs/__tests__/analytics-aggregate.test.ts` ×4 — Do not use `new Array(singleArgument)`.

### eslint-plugin-react-hooks(exhaustive-deps) — 4
- `apps/web/src/shared/components/data-grid/hooks/use-data-grid.ts` ×3 — React Hook useMemo has unnecessary dependency: columns
- `apps/web/src/shared/components/data-grid/lib/compose-refs.ts` — React Hook useCallback received a function whose dependencies are unknown.

### eslint-plugin-jsx-a11y(no-static-element-interactions) — 3
- `apps/web/src/features/logs/components/log-columns.tsx` — Static HTML elements with event handlers require a role.
- `apps/web/src/features/certificates/managed-table.tsx` — Static HTML elements with event handlers require a role.
- `apps/web/src/features/backups/backup-row.tsx` — Static HTML elements with event handlers require a role.

### react-hooks-js(incompatible-library) — 3
- `apps/web/src/features/logs/components/use-logs-table.ts` — Compilation Skipped: Use of incompatible library
- `apps/web/src/features/logs/components/log-viewer.tsx` — Compilation Skipped: Use of incompatible library
- `apps/web/src/shared/components/data-grid/hooks/use-data-grid.ts` — Compilation Skipped: Use of incompatible library

### eslint-plugin-jsx-a11y(anchor-has-content) — 3
- `apps/www/src/components/mdx.tsx` — Missing accessible content when using `a` elements.
- `apps/web/src/shared/components/domains/dns-records-dialog.tsx` — Missing accessible content when using `a` elements.
- `apps/web/src/shared/components/ui/pagination.tsx` — Missing accessible content when using `a` elements.

### eslint(no-control-regex) — 2
- `apps/builder/src/state.ts` — Unexpected control characters
- `packages/shared/src/route-policy.ts` — Unexpected control characters

### eslint-plugin-jsx-a11y(heading-has-content) — 2
- `apps/www/src/components/mdx.tsx` ×2 — Headings must have content and the content must be accessible by a screen reader.

### typescript-eslint(no-misused-spread) — 2
- `packages/jobs/src/__tests__/reconcile.test.ts` — Using the spread operator on class instances will lose their class prototype.
- `packages/api/src/lib/cloudflare.ts` — Using the spread operator on an array in an object will result in a list of indices.

### typescript-eslint(no-redundant-type-constituents) — 2
- `apps/web/src/lib/auth-gate.ts` — 'unknown' overrides all other types in this union type.
- `apps/web/src/features/terminal/data/decode-frame.test.ts` — 'unknown' overrides all other types in this union type.

### typescript-eslint(restrict-template-expressions) — 2
- `packages/api/src/lib/crypto.ts` — Invalid type used in template literal expression.
- `test-infra/scripts/security-certify.mjs` — Invalid type used in template literal expression.

### eslint-plugin-unicorn(no-thenable) — 1
- `packages/jobs/src/__tests__/reconcile.test.ts` — Do not add `then` to an object.

### eslint-plugin-jsx-a11y(html-has-lang) — 1
- `apps/server/src/handlers/deploy-protection/ui/frame.tsx` — Missing lang attribute.

### eslint-plugin-jsx-a11y(lang) — 1
- `apps/server/src/handlers/deploy-protection/ui/frame.tsx` — `lang` attribute must have a valid value.

### eslint(no-misleading-character-class) — 1
- `apps/web/src/features/logs/components/log-severity.ts` — Unexpected surrogate pair in character class.

### eslint-plugin-unicorn(no-empty-file) — 1
- `packages/api/src/routers/caddy/index.ts` — Empty files are not allowed.

### react-hooks-js(set-state-in-effect) — 1
- `apps/web/src/features/updates/components/update-progress-model.ts` — Error: Calling setState synchronously within an effect can trigger cascading renders

### typescript-eslint(require-array-sort-compare) — 1
- `packages/api/src/edge-logs/__tests__/edge-logs.test.ts` — Require 'compare' argument.
