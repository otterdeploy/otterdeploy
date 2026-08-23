# Implementation plan — GHCR auth derived from the GitHub App

**Goal.** When an org has the GitHub App installed, authenticate `ghcr.io` pushes and pulls
with a freshly-minted installation access token instead of a stored personal access token.
No secret at rest, nothing for the user to create.

**Non-goals.** Docker Hub and every other registry keep the existing stored-credential path
unchanged — they are unrelated identity providers and no GitHub credential works there.
Do not touch the `container_registry` encryption scheme.

---

## 0. Context — what already exists

Verified against HEAD. Read these before changing anything.

| Thing | Where | Note |
|---|---|---|
| Mint an installation token | `packages/api/src/git/github-app-core.ts:163` `getInstallationToken(installationId)` | Returns `{ token, expires_at, … }`. Throws `GithubInstallationInvalidError` on 404. |
| Org → App config | `packages/api/src/git/github-app-config.ts:95` `loadGithubAppForOrgIfPresent(orgId)` | Returns `null` when the org has no App. |
| Installation rows | `packages/db/src/schema/git.ts:109` `gitInstallation` | Linked to org via `providerId → gitProvider.organizationId`. Has `suspendedAt`, `revokedAt`, and a `permissions` jsonb snapshot. |
| Stored registry creds | `packages/db/src/schema/build.ts:47` `containerRegistry` | `(org, host, username)` unique. `authType` enum `"password" \| "token"` already exists and is currently unused for this. |
| Deploy-time resolver | `packages/api/src/swarm/registry-auth.ts:52` `resolveRegistryAuth({image, organizationId})` | Derives host from the image ref, returns `RegistryAuth \| null`. |
| `RegistryAuth` shape | `packages/api/src/swarm/image-pull.ts:46` | `{ username, password, serveraddress }`. `serveraddress` MUST match the image's registry host. |
| Builder push | `apps/builder/src/docker-push.ts:33` `dockerPush({tags, credentials, sink})` | `docker login --password-stdin`, then push, then unconditional `logout`. |
| Push callers | `apps/builder/src/pipeline-steps.ts:126`, `apps/builder/src/compose-build-service.ts:93` | Both need the same credential source. |
| Schema already anticipates this | `packages/db/src/schema/build.ts:63` | *"Username/login (or the literal `x-access-token` for some hosts)."* |

**The GHCR contract:** `docker login ghcr.io -u x-access-token --password-stdin`, password =
installation access token. The App must hold the **Packages** permission (`read` to pull,
`write` to push).

---

## 1. Add the App permission and a capability check

**Files:** the App manifest / registration path (search for where `permissions` is declared for
the App manifest flow), `packages/api/src/git/`.

1. Add `packages: write` to the App manifest's requested permissions.
2. Write `orgGhcrCapability(orgId)` returning
   `{ available: boolean; installationId: string | null; reason: "no-app" | "no-installation" | "missing-packages-permission" | "ok" }`.
   Join `gitInstallation → gitProvider` on `organizationId`, filtering `suspendedAt IS NULL AND
   revokedAt IS NULL`.

**Gotcha — read this before using `permissions`.** The schema comment at `git.ts:126` says that
snapshot is *"kept for diagnostics: we never re-grant based on this snapshot."* Use it to drive
UI copy only. Never gate the actual auth path on it — mint the token and let GitHub be the
authority, because adding a permission to an existing App requires every installation to
re-authorize, and the snapshot goes stale until they do.

**Done when:** a unit test covers all four `reason` values.

---

## 2. Teach `resolveRegistryAuth` to derive rather than decrypt

**File:** `packages/api/src/swarm/registry-auth.ts`

Insert one branch **before** the `container_registry` lookup:

```
host = imageRegistry(image)
if host === "ghcr.io":
    cap = orgGhcrCapability(organizationId)
    if cap.available:
        tok = getInstallationToken(cap.installationId)
        return { username: "x-access-token", password: tok.token, serveraddress: "ghcr.io" }
        // on GithubInstallationInvalidError: log, fall through to the table
// unchanged from here
```

Rules:
- **Never cache the token in `container_registry`.** See §5.
- An explicit `ghcr.io` row in `container_registry` should **win** over the derived path — an
  operator who typed a credential in meant it. Decide this explicitly and comment the choice.
- Failure to mint falls through to the existing lookup, then to `null` (anonymous), so this can
  never make a currently-working pull start failing.

**Done when:** tests cover — derived path hit; explicit row overrides; invalid installation falls
through; non-GHCR host is untouched.

---

## 3. Same for the builder push path

**Files:** `apps/builder/src/pipeline-steps.ts:126`, `apps/builder/src/compose-build-service.ts:93`

The builder is a separate process. Do **not** import API internals into it and do **not** hand it
App private key material. Have the control plane resolve credentials and pass them in the job
payload, exactly as the stored path does today.

`PushCredentials` (`docker-push.ts:23`) needs no shape change — `{host, username, password}`
already fits `{ "ghcr.io", "x-access-token", <token> }`.

**Gotcha:** minting must happen when the push job *runs*, not when it is *enqueued*. A job that
sits in the queue longer than the token's ~1 hour lifetime will fail at `docker login` with a
misleading auth error. If the payload is built at enqueue time, add a re-resolve immediately
before `dockerPush`.

`docker logout` already runs unconditionally in the `finally` at `docker-push.ts:68` — verify it
still fires on the login-failure path.

---

## 4. The UI moment

**Files:** `apps/web/src/features/registries/`, `packages/api/src/routers/registry/`

Surface the offer **right after the App connects**, not as a separate credentials chore:

> **Use GitHub for container images too?**
> Your installation can also push and pull from `ghcr.io`. We'll request a fresh token each
> time instead of storing one.
> ( • ) Use my GitHub App — *nothing to create, nothing to rotate, nothing stored*
> ( ) Enter a token manually — *for Docker Hub, or a registry outside GitHub*

In the registries list, show `ghcr.io` as a derived entry with no password field and no rotate
action, visually distinct from stored rows. If `orgGhcrCapability` returns
`missing-packages-permission`, link to the App's permission-update URL and say plainly that
re-authorization is required.

**Copy rule:** never call it a token in the UI. The user's model is "my GitHub is connected."

---

## 5. Guardrails

Add a check that fails loudly rather than a comment nobody reads:

- **Reject writes** to `container_registry` where `host = 'ghcr.io'` and the password looks like
  an installation token (GitHub prefixes them `ghs_`). A stored `ghs_` token works during
  testing and starts failing pulls about an hour later, with the error appearing at deploy time
  far from its cause. This is the single most likely way to get this wrong.
- Ensure the token never reaches a log. `runProcess` already takes `secrets: [password]` for
  redaction (`docker-push.ts:46`) — confirm the derived token is passed there too.
- Add an `audit_log` entry when a derived credential is used, with the installation id and
  **no token material**.

---

## 6. Verification

1. `bun run db:generate` **only if** a schema change was actually needed — this plan may need
   none. Never hand-write a migration; never run `db:push` outside dev.
2. Unit tests per §1–§2.
3. Manual end-to-end: connect the App with Packages → deploy a private `ghcr.io` image → confirm
   the pull succeeds with **no** `container_registry` row for `ghcr.io`.
4. **The expiry test that matters:** deploy, wait >1 hour, redeploy the same service. It must
   still work. This is the regression this whole design exists to prevent, and the only test
   that actually proves it.
5. Confirm Docker Hub and any self-hosted registry still authenticate exactly as before.

---

## Out of scope, worth a follow-up issue

- A Dockerfile pulling a **private base image** during build still needs that registry's own
  credential — unchanged by this work.
- Public Docker Hub base images are rate-limited per IP regardless of login; a pull-through
  cache is a separate task.
- `resolveRegistryAuth` picks the most-recently-updated row when several exist for a host
  (`registry-auth.ts:47`). That heuristic predates this change; once a derived path exists,
  precedence should be stated explicitly rather than left to `updatedAt`.
