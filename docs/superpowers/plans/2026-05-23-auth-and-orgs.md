# Auth Screens & Organizations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `/_auth/sign-in`, `/_auth/sign-up`, and a new `/_auth/onboarding/create-organization` to Better Auth (email + password + organization plugin), replace the fake `user`/`workspaces` loader in `_app/layout.tsx` with a real session + orgs gate, and rename `workspace` → `organization` (slug-based URLs) across the web routes and shell components.

**Architecture:** Better Auth's `organization` plugin (server) + the existing `organizationClient()` on the web. UI routes adopt slug-based URLs (`/<orgSlug>`). The `_app` loader does `getSession` + `organization.list` in parallel and branches to `/sign-in` (no session), `/onboarding/create-organization` (no orgs), or proceeds with route context `{ user, organizations, activeOrgSlug }`. Forms use TanStack Form + zod; errors surface `result.error.message` directly via shadcn `Alert`. The existing `WorkspaceSidebar` is renamed in place to `OrganizationSidebar` (no parallel component).

**Tech Stack:** Better Auth 1.6 (server + `better-auth/react` client + org plugin), TanStack Router (file-based), TanStack Form, shadcn UI (`Card`, `Field`, `Button`, `Input`, `Alert`), zod, drizzle (Postgres), Bun.

**Spec:** `docs/superpowers/specs/2026-05-23-auth-and-orgs-design.md`

---

## File Structure

**Created:**
- `apps/web/src/features/auth/components/auth-shell.tsx` — center-card layout shared by all three auth routes
- `apps/web/src/features/auth/components/sign-in-form.tsx`
- `apps/web/src/features/auth/components/sign-up-form.tsx`
- `apps/web/src/features/auth/components/create-organization-form.tsx`
- `apps/web/src/routes/_auth/onboarding/create-organization.tsx` — new route
- `apps/web/src/features/shell/components/sidebar/organization-sidebar.tsx` — replaces `workspace-sidebar.tsx`

**Modified:**
- `packages/auth/src/index.ts` — add `organization` plugin
- `packages/db/src/schema/auth.ts` — add `organization` / `member` / `invitation` drizzle tables
- `packages/shared/src/id.ts` — add `organization`, `member`, `invitation` ID prefixes
- `apps/web/src/routes/_auth/layout.tsx` — `beforeLoad` session check + render `AuthShell`
- `apps/web/src/routes/_auth/sign-in.tsx` — render `SignInForm`
- `apps/web/src/routes/_auth/sign-up.tsx` — render `SignUpForm`
- `apps/web/src/routes/_app/layout.tsx` — real session + orgs gate
- `apps/web/src/routes/_app/index.tsx` — redirect to active org slug
- `apps/web/src/features/shell/components/sidebar/index.tsx` — re-export rename
- `apps/web/src/features/shell/components/site-header.tsx` — use `orgSlug` instead of `workspaceId`

**Renamed / moved:**
- `apps/web/src/routes/_app/$workspaceId/` → `apps/web/src/routes/_app/$orgSlug/` (entire subtree, 8 files)

**Deleted:**
- `apps/web/src/features/shell/components/sidebar/workspace-sidebar.tsx` (replaced by `organization-sidebar.tsx`)

---

## Task 1: Add organization ID prefixes

**Files:**
- Modify: `packages/shared/src/id.ts`

- [ ] **Step 1: Add new prefixes**

Edit `packages/shared/src/id.ts` and add to the `ID_PREFIX` object (between the auth block and the project block):

```ts
export const ID_PREFIX = {
  // auth
  user: "user",
  session: "session",
  account: "account",
  verification: "verification",
  // organizations
  organization: "org",
  member: "member",
  invitation: "invite",

  project: "project",
  resource: "resource",
  servicePort: "port",
  serviceEnvVar: "senv",
  environment: "env",
  proxyRoute: "proxy_route",
  // workspace: "workspace",
  workspace: "wksp",
} as const;
```

- [ ] **Step 2: Type-check the package**

```bash
bun turbo typecheck --filter=@otterdeploy/shared
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/id.ts
git commit -m "feat(shared): add organization/member/invitation ID prefixes"
```

---

## Task 2: Add organization plugin to Better Auth server

**Files:**
- Modify: `packages/auth/src/index.ts`

- [ ] **Step 1: Import and register the plugin**

Edit `packages/auth/src/index.ts`. Add the import:

```ts
import { organization } from "better-auth/plugins";
```

Add to the `plugins:` array (insert before the existing `polar(...)` entry):

```ts
plugins: [
  organization({
    allowUserToCreateOrganization: true,
    organizationLimit: 10,
    teams: { enabled: false },
  }),
  polar({
    client: polarClient,
    createCustomerOnSignUp: true,
    // ...rest unchanged
  }),
],
```

- [ ] **Step 2: Type-check the package**

```bash
bun turbo typecheck --filter=@otterdeploy/auth
```

Expected: clean (the Polar deps drift is unrelated and pre-existing).

- [ ] **Step 3: Commit**

```bash
git add packages/auth/src/index.ts
git commit -m "feat(auth): enable Better Auth organization plugin"
```

---

## Task 3: Add organization / member / invitation drizzle tables

**Files:**
- Modify: `packages/db/src/schema/auth.ts`

- [ ] **Step 1: Inspect the expected schema**

Run the Better Auth CLI to print the schema the plugin expects:

```bash
bunx @better-auth/cli@latest generate --config packages/auth/src/index.ts --output /tmp/auth-schema.txt
cat /tmp/auth-schema.txt
```

This shows the field set for `organization`, `member`, and `invitation` tables. Use it as the source of truth for field names and types — the steps below match the plugin's defaults at the time of writing.

- [ ] **Step 2: Append tables to the auth schema**

Open `packages/db/src/schema/auth.ts` and append the following blocks (after the existing `verification` table and before the relations block):

```ts
export const organization = pgTable("organization", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId(ID_PREFIX.organization)),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const member = pgTable(
  "member",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId(ID_PREFIX.member)),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("member_organizationId_idx").on(table.organizationId),
    index("member_userId_idx").on(table.userId),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId(ID_PREFIX.invitation)),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at").notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("invitation_organizationId_idx").on(table.organizationId)],
);
```

Also extend the existing `session` table to carry the active-org pointer (Better Auth's org plugin reads/writes `activeOrganizationId` on the session row). Locate the `session = pgTable("session", { ... })` block and add the field inside its column object:

```ts
activeOrganizationId: text("active_organization_id"),
```

- [ ] **Step 3: Add relations**

Append after the existing `accountRelations`:

```ts
export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  invitations: many(invitation),
}));

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  inviter: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}));
```

- [ ] **Step 4: Push the migration**

```bash
bun db:push
```

Expected: prompt confirms creation of `organization`, `member`, `invitation` tables and addition of `session.active_organization_id`. Accept.

- [ ] **Step 5: Type-check**

```bash
bun turbo typecheck --filter=@otterdeploy/db --filter=@otterdeploy/auth
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/auth.ts
git commit -m "feat(db): add organization/member/invitation tables + activeOrganizationId"
```

---

## Task 4: Auth shell component

**Files:**
- Create: `apps/web/src/features/auth/components/auth-shell.tsx`

- [ ] **Step 1: Create the shell**

Write `apps/web/src/features/auth/components/auth-shell.tsx`:

```tsx
import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted p-6">
      <div className="flex w-full max-w-[440px] flex-col gap-6">
        <div className="text-center text-sm font-semibold tracking-tight text-foreground">
          otterdeploy
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            {description ? (
              <CardDescription>{description}</CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">{children}</CardContent>
        </Card>
        {footer ? (
          <div className="text-center text-xs text-muted-foreground">
            {footer}
          </div>
        ) : null}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/features/auth/components/auth-shell.tsx
git commit -m "feat(web/auth): add centered AuthShell card layout"
```

---

## Task 5: Sign-in form

**Files:**
- Create: `apps/web/src/features/auth/components/sign-in-form.tsx`
- Modify: `apps/web/src/routes/_auth/sign-in.tsx`

- [ ] **Step 1: Create the form component**

Write `apps/web/src/features/auth/components/sign-in-form.tsx`:

```tsx
import { useForm } from "@tanstack/react-form";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import * as z from "zod";

import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "./auth-shell";

const signInSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export function SignInForm() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/_auth/sign-in" }) as { redirect?: string };
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { email: "", password: "" },
    validators: { onChange: signInSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const result = await authClient.signIn.email({
        email: value.email,
        password: value.password,
      });
      if (result.error) {
        setFormError(result.error.message ?? "Sign-in failed");
        return;
      }
      void navigate({ to: search.redirect ?? "/" });
    },
  });

  return (
    <AuthShell
      title="Sign in to otterdeploy"
      description="Enter your email and password to continue."
      footer={
        <>
          New here?{" "}
          <Link
            to="/sign-up"
            className="font-medium text-foreground hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <form.Field name="email">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Email</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                type="email"
                autoComplete="email"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {field.state.meta.errors[0] ? (
                <FieldError>{String(field.state.meta.errors[0])}</FieldError>
              ) : null}
            </Field>
          )}
        </form.Field>

        <form.Field name="password">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Password</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                type="password"
                autoComplete="current-password"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {field.state.meta.errors[0] ? (
                <FieldError>{String(field.state.meta.errors[0])}</FieldError>
              ) : null}
            </Field>
          )}
        </form.Field>

        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </AuthShell>
  );
}
```

- [ ] **Step 2: Wire the route to the form**

Replace the entire content of `apps/web/src/routes/_auth/sign-in.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { SignInForm } from "@/features/auth/components/sign-in-form";

const search = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/_auth/sign-in")({
  validateSearch: search,
  component: SignInForm,
});
```

- [ ] **Step 3: Regenerate the route tree**

```bash
cd apps/web && bun x tsr generate && cd ../..
```

Expected: `routeTree.gen.ts` updates without errors.

- [ ] **Step 4: Type-check**

```bash
bun turbo typecheck --filter=web-demo
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/auth/components/sign-in-form.tsx \
        apps/web/src/routes/_auth/sign-in.tsx \
        apps/web/src/routeTree.gen.ts
git commit -m "feat(web/auth): wire sign-in form to Better Auth"
```

---

## Task 6: Sign-up form

**Files:**
- Create: `apps/web/src/features/auth/components/sign-up-form.tsx`
- Modify: `apps/web/src/routes/_auth/sign-up.tsx`

- [ ] **Step 1: Create the form component**

Write `apps/web/src/features/auth/components/sign-up-form.tsx`:

```tsx
import { useForm } from "@tanstack/react-form";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import * as z from "zod";

import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "./auth-shell";

const signUpSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export function SignUpForm() {
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { name: "", email: "", password: "" },
    validators: { onChange: signUpSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const result = await authClient.signUp.email({
        name: value.name,
        email: value.email,
        password: value.password,
      });
      if (result.error) {
        setFormError(result.error.message ?? "Sign-up failed");
        return;
      }
      void navigate({ to: "/onboarding/create-organization" });
    },
  });

  return (
    <AuthShell
      title="Create your otterdeploy account"
      description="Sign up with email and a password."
      footer={
        <>
          Already have an account?{" "}
          <Link
            to="/sign-in"
            className="font-medium text-foreground hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <form.Field name="name">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Name</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                autoComplete="name"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {field.state.meta.errors[0] ? (
                <FieldError>{String(field.state.meta.errors[0])}</FieldError>
              ) : null}
            </Field>
          )}
        </form.Field>

        <form.Field name="email">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Email</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                type="email"
                autoComplete="email"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {field.state.meta.errors[0] ? (
                <FieldError>{String(field.state.meta.errors[0])}</FieldError>
              ) : null}
            </Field>
          )}
        </form.Field>

        <form.Field name="password">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Password</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                type="password"
                autoComplete="new-password"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {field.state.meta.errors[0] ? (
                <FieldError>{String(field.state.meta.errors[0])}</FieldError>
              ) : null}
            </Field>
          )}
        </form.Field>

        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Creating account…" : "Create account"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </AuthShell>
  );
}
```

- [ ] **Step 2: Wire the route to the form**

Replace the content of `apps/web/src/routes/_auth/sign-up.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";

import { SignUpForm } from "@/features/auth/components/sign-up-form";

export const Route = createFileRoute("/_auth/sign-up")({
  component: SignUpForm,
});
```

- [ ] **Step 3: Regenerate route tree + type-check**

```bash
cd apps/web && bun x tsr generate && cd ../..
bun turbo typecheck --filter=web-demo
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/auth/components/sign-up-form.tsx \
        apps/web/src/routes/_auth/sign-up.tsx \
        apps/web/src/routeTree.gen.ts
git commit -m "feat(web/auth): wire sign-up form to Better Auth"
```

---

## Task 7: Create-organization onboarding route

**Files:**
- Create: `apps/web/src/features/auth/components/create-organization-form.tsx`
- Create: `apps/web/src/routes/_auth/onboarding/create-organization.tsx`

- [ ] **Step 1: Create the form component**

Write `apps/web/src/features/auth/components/create-organization-form.tsx`:

```tsx
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import * as z from "zod";

import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "./auth-shell";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const schema = z.object({
  name: z.string().min(1, "Organization name is required"),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .max(48, "Slug must be 48 characters or fewer")
    .regex(slugRegex, "Lowercase letters, numbers, dashes only"),
});

function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function CreateOrganizationForm() {
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);

  const form = useForm({
    defaultValues: { name: "", slug: "" },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const created = await authClient.organization.create({
        name: value.name,
        slug: value.slug,
      });
      if (created.error || !created.data) {
        setFormError(created.error?.message ?? "Could not create organization");
        return;
      }
      const activated = await authClient.organization.setActive({
        organizationId: created.data.id,
      });
      if (activated.error) {
        setFormError(activated.error.message ?? "Could not activate organization");
        return;
      }
      void navigate({ to: "/$orgSlug", params: { orgSlug: created.data.slug } });
    },
  });

  return (
    <AuthShell
      title="Create your organization"
      description="Organizations group your projects, services, and members."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <form.Field name="name">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Name</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => {
                  const next = e.target.value;
                  field.handleChange(next);
                  if (!slugTouched) {
                    form.setFieldValue("slug", deriveSlug(next));
                  }
                }}
              />
              {field.state.meta.errors[0] ? (
                <FieldError>{String(field.state.meta.errors[0])}</FieldError>
              ) : null}
            </Field>
          )}
        </form.Field>

        <form.Field name="slug">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>URL slug</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => {
                  setSlugTouched(true);
                  field.handleChange(e.target.value);
                }}
              />
              {field.state.meta.errors[0] ? (
                <FieldError>{String(field.state.meta.errors[0])}</FieldError>
              ) : null}
            </Field>
          )}
        </form.Field>

        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Creating…" : "Create organization"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </AuthShell>
  );
}
```

- [ ] **Step 2: Create the route**

Create the directory and file:

```bash
mkdir -p apps/web/src/routes/_auth/onboarding
```

Write `apps/web/src/routes/_auth/onboarding/create-organization.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";

import { CreateOrganizationForm } from "@/features/auth/components/create-organization-form";

export const Route = createFileRoute("/_auth/onboarding/create-organization")({
  component: CreateOrganizationForm,
});
```

- [ ] **Step 3: Regenerate route tree + type-check**

```bash
cd apps/web && bun x tsr generate && cd ../..
bun turbo typecheck --filter=web-demo
```

Expected: clean. (The `/$orgSlug` reference inside the form will compile only after Task 9 — for now `tsr generate` will keep the existing `$workspaceId` route; the path is still typed because `to: "/$orgSlug"` will surface a router-type error if the rename is reverted. If this step fails, proceed and re-verify after Task 9.)

If `to: "/$orgSlug"` fails type-checking at this point, change it temporarily to:

```ts
void navigate({ to: "/" });
```

and add a `// TODO: post-rename, switch to /$orgSlug` comment. Task 9 restores the typed navigation.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/auth/components/create-organization-form.tsx \
        apps/web/src/routes/_auth/onboarding/create-organization.tsx \
        apps/web/src/routeTree.gen.ts
git commit -m "feat(web/auth): add organization onboarding route"
```

---

## Task 8: `_auth` layout — redirect signed-in users

**Files:**
- Modify: `apps/web/src/routes/_auth/layout.tsx`

- [ ] **Step 1: Replace the stub layout**

Replace the entire content of `apps/web/src/routes/_auth/layout.tsx`:

```tsx
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_auth")({
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (session.data) {
      throw redirect({ to: "/" });
    }
  },
  component: Outlet,
});
```

- [ ] **Step 2: Type-check**

```bash
bun turbo typecheck --filter=web-demo
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/_auth/layout.tsx
git commit -m "feat(web/auth): redirect signed-in users away from /_auth"
```

---

## Task 9: Rename `$workspaceId` directory to `$orgSlug`

**Files:**
- Rename: `apps/web/src/routes/_app/$workspaceId/` → `apps/web/src/routes/_app/$orgSlug/`

- [ ] **Step 1: Move the directory**

```bash
cd apps/web/src/routes/_app
git mv '$workspaceId' '$orgSlug'
cd ../../../../..
```

Expected: `git status` shows 8 files as renames.

- [ ] **Step 2: Update each file's `createFileRoute` path and param parser**

Edit `apps/web/src/routes/_app/$orgSlug/layout.tsx` — replace the param parser and the route path. New content:

```tsx
import { OrganizationSidebar } from "@/features/shell/components/sidebar";

import { SiteHeader } from "@/features/shell/components/site-header";

import { SidebarInset, SidebarProvider } from "@/shared/components/ui/sidebar";
import {
  createFileRoute,
  notFound,
  Outlet,
  useMatch,
} from "@tanstack/react-router";
import * as z from "zod";

const zOrgSlug = z.object({
  orgSlug: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

export const Route = createFileRoute("/_app/$orgSlug")({
  component: RouteComponent,
  params: {
    parse: ({ orgSlug }) => zOrgSlug.parse({ orgSlug }),
  },
  loader: ({ context, params }) => {
    const organization = context.organizations.find(
      (o) => o.slug === params.orgSlug,
    );
    if (!organization) throw notFound();
    return { crumb: organization.name, organization };
  },
});

function RouteComponent() {
  const { user } = Route.useRouteContext();
  const match = useMatch({
    from: "/_app/$orgSlug/$projectId",
    shouldThrow: false,
  });

  return (
    <div className="[--header-height:calc(--spacing(12))]">
      <SidebarProvider defaultOpen={false} className="flex flex-col">
        <SiteHeader />
        <div className="flex flex-1">
          {!match ? (
            <>
              <OrganizationSidebar collapsible="icon" user={user} />
              <SidebarInset>
                <Outlet />
              </SidebarInset>
            </>
          ) : (
            <Outlet />
          )}
        </div>
      </SidebarProvider>
    </div>
  );
}
```

Note `OrganizationSidebar` is created/renamed in Task 11; until then this file will not type-check. That's expected — the type-check step in this task only runs `tsr generate`, not full `typecheck`.

- [ ] **Step 3: Update remaining route file paths**

In each of the following files, change every occurrence of `"/_app/$workspaceId"` to `"/_app/$orgSlug"` (within `createFileRoute(...)`, `useMatch({ from: ... })`, `useLoaderData({ from: ... })`, and any `from:` arg). Also change `workspaceId` to `orgSlug` in destructured params, `params.workspaceId` to `params.orgSlug`, and `workspace.id` to `organization.slug` when used to build URLs. The files:

- `apps/web/src/routes/_app/$orgSlug/index.tsx`
- `apps/web/src/routes/_app/$orgSlug/networking.tsx`
- `apps/web/src/routes/_app/$orgSlug/servers.tsx`
- `apps/web/src/routes/_app/$orgSlug/settings.tsx`
- `apps/web/src/routes/_app/$orgSlug/team.tsx`
- `apps/web/src/routes/_app/$orgSlug/$projectId/index.tsx`
- `apps/web/src/routes/_app/$orgSlug/$projectId/layout.tsx`
- `apps/web/src/routes/_app/$orgSlug/$projectId/graph.tsx`

For `$orgSlug/index.tsx`, replace its content with:

```tsx
import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";

import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";

export const Route = createFileRoute("/_app/$orgSlug/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">{organization.name}</h1>
      <p className="text-sm text-muted-foreground">
        Projects will list here once project data is wired (out of scope).
      </p>
    </div>
  );
}
```

(The previous version iterated over a fake `workspace.projects` array — that field doesn't exist on the real `Organization` shape. The follow-up project-data spec restores a real listing.)

- [ ] **Step 4: Regenerate the route tree**

```bash
cd apps/web && bun x tsr generate && cd ../..
```

Expected: the generated tree references `/_app/$orgSlug/...` everywhere; no `$workspaceId` left.

- [ ] **Step 5: Commit**

Type-check is deferred to Task 12 (after the sidebar + loader changes land).

```bash
git add apps/web/src/routes apps/web/src/routeTree.gen.ts
git commit -m "refactor(web): rename \$workspaceId route segment to \$orgSlug"
```

---

## Task 10: Update `site-header.tsx` references

**Files:**
- Modify: `apps/web/src/features/shell/components/site-header.tsx`

- [ ] **Step 1: Replace workspace references with organization**

Open `apps/web/src/features/shell/components/site-header.tsx`. Change line 20:

```ts
const { workspace } = useLoaderData({ from: "/_app/$workspaceId" });
```

to:

```ts
const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
```

Then update lines 40-41 (the `Link to` block):

```tsx
to="/$workspaceId"
params={{ workspaceId: workspace.id }}
```

to:

```tsx
to="/$orgSlug"
params={{ orgSlug: organization.slug }}
```

If any other `workspace.` references appear in the file, change them to `organization.`.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/features/shell/components/site-header.tsx
git commit -m "refactor(web/shell): site-header reads organization, not workspace"
```

---

## Task 11: Rename `WorkspaceSidebar` to `OrganizationSidebar`

**Files:**
- Rename: `apps/web/src/features/shell/components/sidebar/workspace-sidebar.tsx` → `organization-sidebar.tsx`
- Modify: `apps/web/src/features/shell/components/sidebar/index.tsx`
- Modify: `apps/web/src/features/shell/components/sidebar/project-sidebar.tsx`

- [ ] **Step 1: Move the file**

```bash
git mv apps/web/src/features/shell/components/sidebar/workspace-sidebar.tsx \
       apps/web/src/features/shell/components/sidebar/organization-sidebar.tsx
```

- [ ] **Step 2: Rename the export and update nav hrefs**

Edit `apps/web/src/features/shell/components/sidebar/organization-sidebar.tsx`:

Change every `/$workspaceId` href in the `workspace` nav array to `/$orgSlug`. Rename the array and the export:

```tsx
const navItems = [
  { titleKey: "nav.projects", href: "/$orgSlug", icon: Home01Icon },
  {
    titleKey: "nav.servers",
    href: "/$orgSlug/servers",
    icon: ServerStack01Icon,
    badge: "3",
  },
  {
    titleKey: "nav.networking",
    href: "/$orgSlug/networking",
    icon: EarthIcon,
  },
  { titleKey: "nav.terminal", href: "/$orgSlug/terminal", icon: FlashIcon },
  { titleKey: "nav.settings", href: "/$orgSlug/settings", icon: Sun03Icon },
] as const satisfies ReadonlyArray<NavItem>;
```

And further down:

```tsx
export function OrganizationSidebar({
  user,
  ...props
}: React.ComponentProps<typeof Sidebar> & { user: User }) {
  // ...rest unchanged, but inside it map over `navItems` instead of `workspace`
```

The `{t("nav.workspace")}` group label can stay as-is (the i18n key is just a string identifier; renaming i18n keys is a separate cleanup).

- [ ] **Step 3: Update the barrel re-export**

Edit `apps/web/src/features/shell/components/sidebar/index.tsx`. Replace:

```ts
export { WorkspaceSidebar } from "./workspace-sidebar";
```

with:

```ts
export { OrganizationSidebar } from "./organization-sidebar";
```

- [ ] **Step 4: Update `project-sidebar.tsx` hrefs**

In `apps/web/src/features/shell/components/sidebar/project-sidebar.tsx`, replace every `/$workspaceId/$projectId` href with `/$orgSlug/$projectId` (lines around 39-40 and any others).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/shell/components/sidebar/
git commit -m "refactor(web/shell): rename WorkspaceSidebar to OrganizationSidebar"
```

---

## Task 12: Replace `_app/layout.tsx` loader with real session + orgs

**Files:**
- Modify: `apps/web/src/routes/_app/layout.tsx`

- [ ] **Step 1: Rewrite the loader**

Replace the entire content of `apps/web/src/routes/_app/layout.tsx`:

```tsx
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { authClient, type Session } from "@/lib/auth-client";

export type Organization = {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  createdAt: string | Date;
};

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ location }) => {
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({
        to: "/sign-in",
        search: { redirect: location.pathname },
      });
    }

    const orgs = await authClient.organization.list();
    if (orgs.error) {
      throw new Error(orgs.error.message ?? "Failed to load organizations");
    }
    const organizations = (orgs.data ?? []) as Organization[];
    if (organizations.length === 0) {
      throw redirect({ to: "/onboarding/create-organization" });
    }

    const activeId = (session.data.session as Session["session"] & {
      activeOrganizationId?: string | null;
    }).activeOrganizationId;
    const activeOrg =
      organizations.find((o) => o.id === activeId) ?? organizations[0];

    return {
      user: session.data.user,
      organizations,
      activeOrgSlug: activeOrg.slug,
    };
  },
  component: Outlet,
});
```

- [ ] **Step 2: Update `_app/index.tsx` to redirect to active slug**

Replace `apps/web/src/routes/_app/index.tsx`:

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/")({
  beforeLoad: ({ context }) => {
    throw redirect({
      to: "/$orgSlug",
      params: { orgSlug: context.activeOrgSlug },
    });
  },
});
```

- [ ] **Step 3: Regenerate the route tree + type-check**

```bash
cd apps/web && bun x tsr generate && cd ../..
bun turbo typecheck --filter=web-demo
```

Expected: clean. If there are any leftover `workspaceId` / `WorkspaceSidebar` / `workspace.` references, fix them as the compiler reports them. None should be expected at this point.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/_app/layout.tsx \
        apps/web/src/routes/_app/index.tsx \
        apps/web/src/routeTree.gen.ts
git commit -m "feat(web): gate _app on real session + organizations"
```

---

## Task 13: Manual verification

**Files:** none (browser-driven check)

- [ ] **Step 1: Start the stack**

In separate terminals (or via your usual `bun dev` orchestration):

```bash
bun dev
```

Expected: server running on the api hostname, web running on its portless hostname.

- [ ] **Step 2: Sign-up flow**

1. Visit the web URL — should land on `/sign-in` (no session).
2. Click "Create an account" → `/sign-up`.
3. Submit name + email + password (≥8 chars).
4. Expect redirect to `/onboarding/create-organization`.
5. Type a name; verify the slug auto-fills.
6. Submit. Expect redirect to `/<slug>` showing the organization name.

- [ ] **Step 3: Slug collision**

1. Sign out (NavUser → Sign out).
2. Create a second account.
3. On the onboarding form, try the slug from step 2.
4. Expect inline alert with the Better Auth uniqueness message.

- [ ] **Step 4: Sign-in + active-org persistence**

1. Sign out.
2. Sign in with the first account's credentials.
3. Expect to land at `/<first-org-slug>` (the active org).

- [ ] **Step 5: Cross-org URL guard**

1. While signed in as the first user, manually visit `/<second-user-slug>`.
2. Expect a redirect back to `/<first-org-slug>` (the `notFound()` in `$orgSlug/layout.tsx` triggers the parent error handler — verify your default `notFoundComponent` behaves as you want; if it 404s instead of redirecting, that's also acceptable per the spec).

- [ ] **Step 6: Bad creds**

1. Sign out.
2. Submit wrong password on `/sign-in`.
3. Expect inline destructive alert with the Better Auth message.

- [ ] **Step 7: Final commit**

Nothing to commit if the manual checks all pass — close the loop with a clean working tree:

```bash
git status
```

Expected: clean.

---

## Self-Review

- **Spec coverage** — every section of the spec maps to at least one task:
  - 3.1 plugin → Task 2; 3.2 schema → Task 3; 3.3 session shape uses Task 3's
    `active_organization_id` column.
  - 4.1 client already exists (no task needed, called out in spec).
  - 4.2 new routes → Tasks 5, 6, 7. 4.3 layout changes → Tasks 8, 12. 4.4
    directory rename → Task 9. 4.5 sidebar/component renames → Tasks 10, 11.
    4.6 visual layout → Task 4.
  - 5.x data flows are exercised by the Task 13 checklist.
  - 6 error handling — forms in Tasks 5, 6, 7 all surface
    `result.error.message`; loader errors in Tasks 8, 12 use `throw redirect`
    and `throw new Error`.
  - 7 testing — Task 13 is the manual checklist; no new vitest suites by spec
    decision.
  - 8 rollout — `bun db:push` in Task 3; no flag.

- **Placeholder scan** — no TBDs or "TODO"s. The one conditional fallback
  in Task 7 step 3 (using `to: "/"` if `/$orgSlug` doesn't yet type-check)
  is bounded and resolved by Task 9.

- **Type consistency** —
  - `Organization` type defined in Task 12, referenced by Task 9's loader
    (which uses the route-context `organizations` array).
  - `orgSlug` param name is consistent across Tasks 7, 9, 10, 11, 12.
  - `authClient.organization.create` returns `{ data: { id, slug, ... } }` —
    Task 7 uses both `id` (for `setActive`) and `slug` (for navigation).
  - `OrganizationSidebar` is exported from the barrel in Task 11 and
    imported by the renamed layout in Task 9.

- **Order safety** — Tasks 9, 10, 11 leave the tree in an intentionally
  non-type-checking state between commits, but each tier of the rename is
  one logical unit and Task 12 explicitly verifies the whole tree compiles
  before declaring done. If you need green-on-every-commit, fold Tasks
  9-12 into one commit.
