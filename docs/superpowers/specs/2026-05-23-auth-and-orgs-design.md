# Auth Screens & Organizations — Design Spec

**Date:** 2026-05-23
**Owner:** Jefferson
**Status:** Approved (brainstorming → implementation)

## 1. Goal

Replace the stub auth routes (`/_auth/sign-in`, `/_auth/sign-up`) and the
hardcoded fake `user` + `workspaces` in `_app/layout.tsx` with real
end-to-end authentication and a real multi-tenant organization model.

Concretely:

- Real sign-in and sign-up forms wired to Better Auth (email + password).
- Session-gated `_app/*` routes — unauth users get redirected, signed-in
  users get their real user + organization data.
- First-org onboarding flow at `/_auth/onboarding/create-organization`.
- Better Auth `organization` plugin powers the workspace concept; UI and
  URLs are renamed from "workspace" to "organization".
- URL identifier is the org **slug** (`/<orgSlug>/...`).

## 2. Out of Scope (Explicit Follow-Ups)

Each is its own future spec.

- OAuth providers (Google / GitHub) on auth pages.
- Forgot / reset password flow.
- Email verification (`requireEmailVerification`).
- 2FA / TOTP plugin.
- Members / invitations / role-management UI on `/team` — the DB tables
  ship with this spec via the org plugin, but the UI is its own design.
- Replacing the hardcoded `projects` / `environments` arrays inside an org
  with real API data.
- Polar plugin reconciliation. `packages/auth/package.json` recently
  dropped `@polar-sh/better-auth` + `@polar-sh/sdk`, but
  `packages/auth/src/index.ts` still imports and configures them. Either
  restore the deps or strip Polar from `auth.ts`; out of scope here.

## 3. Backend Changes

### 3.1 `packages/auth/src/index.ts`

Add the `organization` plugin to the existing `plugins:` array:

```ts
import { organization } from "better-auth/plugins";

plugins: [
  organization({
    allowUserToCreateOrganization: true,
    organizationLimit: 10,
    teams: { enabled: false },
  }),
  // existing polar plugin stays as-is (deps reconciliation is out of scope)
];
```

No custom hooks; plugin defaults are fine for v1.

This makes the server side match the client side's existing
`organizationClient()` plugin — currently the client expects the plugin
endpoints but the server doesn't expose them.

### 3.2 DB schema

Run `bun better-auth migrate` (or generate → `bun db:push`). The plugin
adds `organization`, `member`, `invitation` tables. We do not hand-author
their schema — Better Auth owns it and the drizzle adapter picks them up
via the existing schema-module import.

Verify generated tables land alongside the rest of the auth schema in
`packages/db/src/schema/auth.ts` so the drizzleAdapter sees them.

### 3.3 Session shape

With the plugin enabled, `session.activeOrganizationId` is populated by
Better Auth. `authClient.organization.setActive({ organizationId })`
flips it. `authClient.organization.list()` returns the user's orgs.

No new oRPC router. Plugin client methods cover create / list / setActive
/ getFullOrganization — an oRPC passthrough would add nothing.

### 3.4 Server-side org permission checks

Not in this spec — no router yet enforces org membership. Adding
`requireMember` checks to existing routers (project, env, docker, caddy)
is part of the future members/invites spec, not this one.

## 4. Web Changes

### 4.1 Auth client (already in place)

`apps/web/src/lib/auth-client.ts` already exists with the client-side
plugins wired:

```ts
export const authClient = createAuthClient({
  baseURL: env.VITE_SERVER_URL,
  plugins: [
    organizationClient(),
    adminClient(),
    magicLinkClient(),
    apiKeyClient(),
  ],
});
```

No new file. This spec relies on `authClient.signIn.email`,
`authClient.signUp.email`, `authClient.signOut`, `authClient.useSession`,
`authClient.getSession`, and `authClient.organization.{ create, list,
setActive }`.

**Drift to flag (not blocking this spec):** `adminClient`,
`magicLinkClient`, and `apiKeyClient` are on the client but the server
(`packages/auth/src/index.ts`) does not enable the corresponding
plugins. They're dormant — calls would 404, but nothing in this spec
calls them. Server-side enablement of those plugins is its own
follow-up.

Cookie config is already correct server-side: `sameSite: "none"; secure:
true; httpOnly: true` so cross-origin auth works.

### 4.2 New routes

| Path                                          | Purpose                                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| `/_auth/sign-in.tsx`                          | Real email + password form. Replaces the `<div>Hello` stub.                            |
| `/_auth/sign-up.tsx`                          | Name + email + password form. Replaces the stub.                                       |
| `/_auth/onboarding/create-organization.tsx`   | Name + slug form. Reached after sign-up or when a signed-in user lands without an org. |

Form library: **TanStack Form** (already in `apps/web/package.json`,
matches the TanStack-everywhere posture). One zod schema per form.

### 4.3 Modified routes

**`/_auth/layout.tsx`** — center-card shell. `beforeLoad` checks the
session; if signed-in, `throw redirect({ to: "/" })`.

**`/_app/layout.tsx`** — `beforeLoad` does the real session + org gate
(replaces the fake `user` + `workspaces` block):

```ts
const session = await authClient.getSession({ fetchOptions: { headers } });
if (!session.data) {
  throw redirect({
    to: "/sign-in",
    search: { redirect: location.pathname },
  });
}
const orgs = await authClient.organization.list();
if (orgs.data.length === 0) {
  throw redirect({ to: "/onboarding/create-organization" });
}
return {
  user: session.data.user,
  organizations: orgs.data,
  activeOrgSlug: orgs.data.find((o) => o.id === session.data.session.activeOrganizationId)?.slug
    ?? orgs.data[0].slug,
};
```

Use `Promise.all` for the two calls if Better Auth client supports it
cleanly.

**`/_app/index.tsx`** — redirect to `/<activeOrgSlug>`. Pure loader.

### 4.4 Route directory rename

`apps/web/src/routes/_app/$workspaceId/` → `apps/web/src/routes/_app/$orgSlug/`

Inside, every reference to `params.workspaceId` and the `zWorkspaceId`
parser becomes `params.orgSlug` validated against a slug regex (lower
alphanumerics + dashes, length bounds), not against the `wksp_` prefix.

The `$orgSlug` layout (`_app/$orgSlug/layout.tsx`) validates the URL slug
against `organizations` from parent context. If not in the list, redirect
to `/<activeOrgSlug>` (preferred over 404; less hostile if a user
bookmarks an org they were removed from).

`ID_PREFIX.workspace` stays in `packages/shared/src/id.ts` as dead code
for now — UI just stops using it. Removing it is a separate cleanup PR
once nothing in `packages/api` references it either.

### 4.5 Component renames (in place)

Per the user's stated guidance ("rename in place since they're already
the right components, just with the wrong noun"), not parallel new
components:

- `features/shell/components/sidebar/workspace-sidebar.tsx` →
  `organization-sidebar.tsx`
- Props / locals: `workspaces` → `organizations`, `workspaceId` →
  `orgSlug`, `Workspace` → `Organization` type.
- `_app/layout.tsx` loader output types: `Workspace` → `Organization`.
  Drop the fake `projects` / `environments` fields on the type — they
  stay hardcoded in components until the follow-up spec.

### 4.6 Visual layout

Centered card on `bg-muted`, 24px page padding, max-width ~440px card.
Logo above the card. Card uses shadcn `Card` + `Field` + `Button` +
`Input`. Same shell for sign-in, sign-up, and create-org (only the form
body changes).

## 5. Data Flow

### 5.1 Unauth user → protected page

1. User visits `/foo/bar`.
2. `_app/layout.tsx beforeLoad` runs `authClient.getSession()` → returns
   `null`.
3. `throw redirect({ to: "/sign-in", search: { redirect: "/foo/bar" } })`.
4. Sign-in form submits → `authClient.signIn.email(...)` → server
   `/api/auth/sign-in/email` sets cookie.
5. Navigate to `search.redirect ?? "/"`.
6. `_app/layout.tsx beforeLoad` re-runs with the session → branches to
   the org check.

### 5.2 Sign-up → onboarding → app

1. `authClient.signUp.email({ name, email, password })` — Better Auth
   automatically creates a session.
2. Navigate to `/onboarding/create-organization`.
3. Form submits → `authClient.organization.create({ name, slug })`.
4. Followed by `authClient.organization.setActive({ organizationId: created.id })`.
5. Navigate to `/<slug>`.

### 5.3 Existing user with orgs

1. `getSession()` returns `{ user, session: { activeOrganizationId, ... } }`.
2. `organization.list()` returns the user's orgs.
3. Both populate `_app/layout.tsx` route context.
4. `_app/$orgSlug/layout.tsx` validates `params.orgSlug` against the
   list; redirects to `activeOrgSlug` if missing.
5. Sidebar reads `organizations` from route context — no extra fetch.

### 5.4 Sign-out

1. `NavUser` → `authClient.signOut()` → cookie cleared.
2. `navigate({ to: "/sign-in" })`.

### 5.5 Performance note

`getSession` + `list` is two requests per `_app` navigation. `Promise.all`
in the loader. If it becomes hot in practice, swap to TanStack Query
caching keyed by session ID — not v1 work.

## 6. Error Handling

Better Auth client methods return `{ data, error }` (not throws). All
call sites branch on `result.error`.

- **Forms** — surface `result.error.message` directly into an inline
  destructive shadcn `Alert` at the top of the card. No code-by-code
  mapping in v1. Field-level zod validation errors render under each
  field via the shadcn `Field` primitive.
- **Loaders** — `authClient.getSession` returning `data: null` is the
  unauth signal; redirect to `/sign-in`. Any thrown / network failure
  from `organization.list` is `throw`n so the nearest TanStack Router
  `errorComponent` renders.
- **Submit UX** — TanStack Form's `isSubmitting` disables the button +
  shows an inline spinner. No optimistic UI; auth flows are blocking.

Typed app-error catalogs (evlog `createError`) are out of scope. Error
codes from Better Auth are strings; we don't pattern-match on them in
this spec.

## 7. Testing

- **No new vitest suites for this spec.** The valuable test surface (the
  org plugin itself, oRPC routers) is either upstream or outside this
  spec's scope. Adding form-component tests for three tiny forms is low
  ROI.
- **Manual verification checklist** for the implementation plan:
  - [ ] Fresh sign-up → lands in `/onboarding/create-organization`.
  - [ ] Create-org form rejects duplicate slug with the server's
    `result.error.message`.
  - [ ] After create-org → lands in `/<slug>`.
  - [ ] Sign-out → next visit to `/<slug>` redirects to `/sign-in`.
  - [ ] Sign-in with the same creds → lands back at `/<slug>` (active
    org preserved across sessions).
  - [ ] Visiting `/<slug>` for an org the current user is not a member of
    → redirects to the user's active org slug.
  - [ ] Invalid creds → inline alert from `result.error.message`.
  - [ ] Rate-limit (server has `max: 100, window: 60`) — manually verify
    the surfaced message reads reasonably.
- Run the dev server and click both flows in a browser before claiming
  the work is done.

## 8. Rollout

- No feature flag. This replaces stub routes that nothing depends on.
- Single PR ships the whole spec.
- DB migration: `bun better-auth migrate` (or generate → `bun db:push`).
- No existing data to backfill — fake `workspaces` were hardcoded; real
  users will create orgs through the onboarding flow.

## 9. Open Items (Tracked, Not Blocking)

- Polar deps drift in `packages/auth` (Section 2 — explicit follow-up).
- `ID_PREFIX.workspace` removal from `packages/shared/src/id.ts` once
  `packages/api` stops referencing it.
- Future `_app/$orgSlug/layout.tsx` validation behavior — currently
  redirect to active slug, may want a "no access" page later.
