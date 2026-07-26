# Encryption domains, key rotation, and sealed variables

Status: **shipped** (od-5j8.12). Implements the domain-separation, key-
rotation, and sealed-variable portion of od-5j8's "secure sovereign VPS
control plane" epic.

## Problem

Before this change, `packages/api/src/lib/crypto.ts` derived exactly ONE
AES-256-GCM key (HKDF over `BETTER_AUTH_SECRET`) and used it for every secret
the platform stores at rest: SSH private keys, registry passwords, custom
certificate private keys, GitHub App credentials, backup archives. Two
problems followed directly from that:

1. **No domain separation.** A bug or a targeted compromise that recovered
   the derived key exposed every secret category at once — an SSH key leak
   and a registry-credential leak were the same failure.
2. **No rotation path.** `BETTER_AUTH_SECRET` is also the auth-signing
   secret; rotating it invalidates sessions AND silently breaks every
   encrypted-at-rest row (old ciphertext stops decrypting the moment the env
   var changes), so in practice nobody could rotate it at all.

Separately, project/service env vars (`project_env_var`, `service_env_var`)
had no way to store a genuinely write-only secret — every value, including
ones flagged `isSecret`, was plaintext in the DB and returned verbatim by
`list`/`get` endpoints (masking was purely a client-side UI toggle).

## Encryption domains

`packages/api/src/lib/crypto.ts` now derives an INDEPENDENT key per purpose
via HKDF domain separation (same input key material, different `info`
label — cryptographically independent outputs):

| Domain | What it protects |
|---|---|
| `env-vars` | Sealed project/service env var values |
| `ssh-keys` | SSH private key material (`ssh_key.private_key_ciphertext`) |
| `registry-creds` | Container registry passwords (`container_registry.encrypted_password`) |
| `git-secrets` | GitHub App client secret / webhook secret / private key PEM (`git_provider.*_ciphertext`) |
| `certs` | Custom certificate private keys (`custom_certificate.key_ciphertext`) |
| `server-secrets` | Ephemeral BullMQ-job-payload provisioning credentials (one-time SSH password, mesh auth key, Cloudflare tunnel token) |
| `db-creds` | Reserved for `database_resource.password` — **not yet wired**, see "Known gaps" below |

Compromising or rotating one domain's key never gives you another domain's
key — even though (by default, zero-config) they all trace back to the same
`BETTER_AUTH_SECRET` root, HKDF's domain separation means an attacker with
one derived key learns nothing about another domain's key. See
`crypto.test.ts`'s "does NOT decrypt cross-domain" tests, including one that
hand-forges an envelope's declared domain to prove the underlying KEY (not
just a label check) differs.

## Ciphertext envelope formats

Two formats coexist, both base64url with no padding:

```
v1.<nonce>.<ciphertext_with_tag>                        (legacy, pre-rework)
v2:<domain>:<keyId>:<nonce>:<ciphertext_with_tag>        (current)
```

- `nonce`: 12 random bytes (AES-GCM standard), fresh per encryption.
- `ciphertext_with_tag`: AES-GCM output (ciphertext || 16-byte tag).
- `keyId`: which entry in the keyring (see below) the ciphertext is under.

**v1 is permanently supported for decryption.** `decryptForDomain(blob,
domain)` transparently accepts a v1 blob under ANY `domain` argument — v1
predates domain separation, so there's no domain to check. Old data never
stops decrypting; see `crypto.test.ts`'s "v1 -> v2 backward compatibility"
suite. `encryptSecret`/`decryptSecret` (the original API) are UNCHANGED —
every caller that wasn't migrated to a domain in this pass keeps working
exactly as before.

## Keyring and rotation

New, optional, additive env vars (`packages/env/src/server.ts`):

- `DATA_ENCRYPTION_KEYS` — `"id:secret,id:secret,..."`. Each secret must be
  ≥ 32 chars or the process refuses to boot (fails closed — see
  `buildKeyringFrom` and its boot-time validation tests). **Never reuse an
  id for different material** — an id is a permanent pointer to one secret
  for as long as any ciphertext references it.
- `DATA_ENCRYPTION_KEY_ID` — which id NEW encryptions use. Defaults to `"1"`.

**Zero-config default:** with neither var set, the keyring has exactly one
entry, id `"1"`, sourced from `BETTER_AUTH_SECRET` — domain separation still
applies (every domain gets its own derived key), you just don't get an
independent rotation root until you provision one.

### Rotation procedure

1. Generate a new random secret (≥ 32 chars), e.g. `openssl rand -base64 32`.
2. Add it to the keyring under a NEW id, keeping every existing id:
   ```
   DATA_ENCRYPTION_KEYS=1:<original-secret>,2:<new-secret>
   ```
3. Point new writes at the new id:
   ```
   DATA_ENCRYPTION_KEY_ID=2
   ```
4. Restart the control plane. From this point, every NEW encryption
   (registry credential added, SSH key generated, sealed var set, …) uses
   id `2`. Every EXISTING ciphertext under id `1` still decrypts — nothing
   is invalidated.
5. Re-encrypt existing data onto the new id with the operator command:
   ```bash
   bun --filter @otterdeploy/api rotate:encryption-keys -- --dry-run   # preview
   bun --filter @otterdeploy/api rotate:encryption-keys                # apply
   ```
   This walks every ciphertext column (`packages/api/scripts/
   rotate-encryption-keys.ts`) and re-encrypts any row still on an old
   key id or the legacy v1 format. Idempotent — re-running it after a clean
   rotation reports 0 rotated everywhere.
6. Once a clean run reports 0 remaining rows on id `1`, you may drop it from
   `DATA_ENCRYPTION_KEYS`. Until then, keep it — anything still referencing
   it (a row rotate-encryption-keys hasn't reached, or genuinely missed a
   restart) would become unreadable if you remove it early.

Rotating `DATA_ENCRYPTION_KEYS`/`DATA_ENCRYPTION_KEY_ID` is **completely
independent of `BETTER_AUTH_SECRET`** — session/auth signing rotates on its
own schedule without touching data-at-rest encryption, and vice versa. This
is the "separate auth signing and data encryption keys" half of od-5j8's
acceptance criteria.

## Sealed variables (write-only secrets)

`project_env_var` and `service_env_var` both gained a `sealed boolean NOT
NULL DEFAULT false` column (migration
`packages/db/migrations/20260726080447_sealed_env_vars`).

**Contract:**

- Setting `sealed: true` on a write (`project.envVar.upsert` /
  `service.env.set`) encrypts the value with the `env-vars` domain key
  before storing it. Sticky and one-way — once a row is sealed, every
  subsequent write to that key stays sealed even if the caller omits the
  flag; there is no "unseal" operation.
- The only ways to change a sealed variable after it's set are **replace**
  (write a new value — still sealed, still write-only) or **delete**. There
  is no reveal/read-back path.
- Every list/read endpoint masks a sealed row's `value` to `""` before it
  leaves the server: `project/env-var.ts`'s `maskSealed`, `service/
  views.ts`'s `mapEnvVar`, `project/views.ts`'s `mapServiceResource`
  (`extraEnv`/`sealedKeys`), and `project/resource-runtime.ts`'s
  `listResourceEnv`. The masking happens at multiple independent layers
  deliberately — belt and suspenders, see the "hostile path" tests below.
- `bulkReplaceProjectEnvVars` / `bulkReplaceServiceEnvVars` (the "Save all"
  bulk editors) never delete or overwrite a sealed row, even if the
  client's payload includes a same-keyed entry — the bulk editors round-trip
  values the client read back from the API, and a sealed row's plaintext
  was never sent to it. Sealed vars are managed one key at a time.
- The manifest reconciler never sees a sealed row's ciphertext: `project/
  manifest-state.ts`'s `loadCurrentState` excludes sealed rows from the
  diff's "current" env view, and `service/env-handlers.ts`'s
  `syncManifestEnvAfterLiveEdit` excludes them from the declared-manifest
  back-sync. Sealed vars are live-managed only, the same way a `${secret}`
  manifest sentinel already worked before this feature.
- **Decryption happens in exactly one place:** the variable resolver
  (`packages/api/src/lib/variables/resolver.ts`'s `resolveEnvFor`, plus
  `project/queries/project.ts`'s `loadProjectEnvBag` for the `project`/
  `environment` scope) — i.e. at deploy/injection time, when the value is
  about to become a container's actual environment. No other code path
  calls `decryptForDomain(..., "env-vars")`.

## Testing evidence

- `packages/api/src/lib/__tests__/crypto.test.ts` — v1 round-trip/tamper/
  malformed-input (pre-existing, kept green), v2 round-trip per domain,
  cross-domain rejection (including a forged-envelope-domain case), v1→v2
  backward compatibility, rotation (`rotateForDomain`, no-op-when-current),
  and keyring boot-time validation (missing/short master key throws).
- `packages/api/src/lib/variables/resolver.test.ts` — sealed service env
  var decrypts correctly at resolution, a tampered sealed ciphertext fails
  resolution instead of injecting garbage.
- `packages/api/src/routers/project/__tests__/env-var-sealed.test.ts` and
  `packages/api/src/routers/project/queries/__tests__/project-env-sealed.test.ts`
  — hostile-path masking on list/upsert-echo/bulk-replace, sticky-seal +
  real encryption on write, bulk-replace preserves an existing sealed row
  against a smuggled overwrite.
- `packages/api/src/routers/service/queries/__tests__/env-sealed.test.ts`
  and `packages/api/src/routers/service/__tests__/env-view-sealed.test.ts`
  — the same coverage for the service-scoped env var surface.

## Known gaps (intentionally out of scope for od-5j8.12)

- **`database_resource.password`** is stored in plaintext — this pre-dates
  the encryption rework entirely and touches live provisioning/connection-
  string code across the swarm driver; migrating it safely is a separate,
  larger piece of work. The `db-creds` domain is declared and ready for it.
- **Backup archive encryption** (`encryptBytes`/`decryptBytes`) stays on the
  shared legacy (v1) key in this pass — it wasn't touched to avoid any risk
  to existing, already-written backup archives on operator disks. Rotating
  `BETTER_AUTH_SECRET` (keyring id `"1"`) still re-keys it exactly as
  before this feature existed; it just doesn't get its own domain yet.
- **`organization`-scoped secrets** (SMTP settings), **webhook** signing
  secrets, and **notification channel** tokens were left on the original
  `encryptSecret`/`decryptSecret` v1 API — those routers were being edited
  concurrently by another workstream during this change and were
  deliberately avoided to prevent merge conflicts. They keep working
  unchanged (v1 decryption is permanently supported) and are natural
  follow-ups: swap their `encryptSecret`/`decryptSecret` calls for
  `encryptForDomain`/`decryptForDomain` with a suitable domain (e.g. adding
  a `"notifications"`/`"webhooks"` domain to `SECRET_DOMAINS`).
