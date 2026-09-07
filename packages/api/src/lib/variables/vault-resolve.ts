/**
 * Deploy-time resolution of `${{vault.<provider>.<ref>}}` tokens.
 *
 * Batched by construction: the resolver hands over every vault token in a
 * record at once, tokens are grouped by provider name, the org's provider
 * rows load ONCE per resolve, credentials decrypt once per provider, and each
 * provider gets a single `getSecrets` call. Values live only in the
 * per-resolve state: nothing is cached across resolves and nothing resolved
 * here is ever persisted.
 *
 * One ref namespace never reaches a provider: `otterdeploy/*` addresses the
 * CONNECTION's own credentials (see ./vault-connection-ref.ts) and resolves
 * off the stored row. It is split out before `getSecrets` so it costs no
 * round trip and stays available when the provider itself is unreachable —
 * which matters, because it is the credential an app uses to reach that
 * provider in the first place.
 */

import type { OrganizationId } from "@otterdeploy/shared/id";

import { zId } from "@otterdeploy/shared/id";
import { Result } from "better-result";

import type { VaultProviderRecord } from "../../routers/vault-provider/queries";
import type { Token, VaultToken } from "./parser";

import { VaultResolveError } from "../../routers/service/errors";
import { listVaultProvidersByOrg } from "../../routers/vault-provider/queries";
import { decryptForDomain } from "../crypto";
import { getSecrets } from "../vault";
import { isConnectionRef, resolveConnectionRef } from "./vault-connection-ref";

export interface VaultResolveState {
  /** Null when the project row didn't carry an org (only mocked test data). */
  organizationId: OrganizationId | null;
  /** Provider rows by name: loaded lazily, once per resolve. */
  providers: Map<string, VaultProviderRecord> | null;
  /** Fetched values keyed by `vaultValueKey(provider, ref)`. */
  values: Map<string, string>;
}

// The project row's `organizationId` column is a plain string; brand it at
// this boundary with a real schema parse (house rule: no assertions).
const orgIdSchema = zId("org");

export function createVaultState(organizationId: string | null | undefined): VaultResolveState {
  const parsed = organizationId != null ? orgIdSchema.safeParse(organizationId) : null;
  return {
    organizationId: parsed?.success ? parsed.data : null,
    providers: null,
    values: new Map(),
  };
}

function vaultValueKey(provider: string, ref: string): string {
  // \0 can't appear in either segment (parser grammar), so the key is
  // collision-free without escaping.
  return `${provider}\0${ref}`;
}

/**
 * The substitution-time lookup. Values were batch-fetched by
 * `loadVaultValues` before any substitution runs; a miss means a token
 * slipped past that pass, so fail loudly rather than injecting an empty
 * string into a secret slot.
 */
export function vaultValueFor(
  token: VaultToken,
  state: VaultResolveState,
): Result<string, VaultResolveError> {
  const value = state.values.get(vaultValueKey(token.provider, token.ref));
  if (value === undefined) {
    return Result.err(
      new VaultResolveError({
        providerName: token.provider,
        ref: token.ref,
        detail: "value was not fetched before substitution",
      }),
    );
  }
  return Result.ok(value);
}

/**
 * Ensure every vault token in `tokens` has a value in `state.values`.
 * Unknown provider name, provider API failure, or a missing key all surface
 * as `VaultResolveError`: the caller threads it through the usual
 * ResolveError channel (resource marked invalid, error mapped at the router).
 */
export async function loadVaultValues(
  tokens: Token[],
  state: VaultResolveState,
): Promise<Result<true, VaultResolveError>> {
  // Group the not-yet-fetched refs per provider.
  const pending = new Map<string, Set<string>>();
  for (const token of tokens) {
    if (token.kind !== "vault") continue;
    if (state.values.has(vaultValueKey(token.provider, token.ref))) continue;
    const bucket = pending.get(token.provider);
    if (bucket) bucket.add(token.ref);
    else pending.set(token.provider, new Set([token.ref]));
  }
  if (pending.size === 0) return Result.ok(true);

  const firstRefOf = (refs: Set<string>): string => [...refs][0] ?? "";

  if (!state.organizationId) {
    const [providerName, refs] = [...pending.entries()][0] ?? ["", new Set<string>()];
    return Result.err(
      new VaultResolveError({
        providerName,
        ref: firstRefOf(refs),
        detail: "could not determine the workspace that owns this project",
      }),
    );
  }

  if (state.providers === null) {
    const rows = await listVaultProvidersByOrg(state.organizationId);
    state.providers = new Map(rows.map((row) => [row.name, row]));
  }

  for (const [providerName, refs] of pending) {
    const row = state.providers.get(providerName);
    if (!row) {
      return Result.err(
        new VaultResolveError({
          providerName,
          ref: firstRefOf(refs),
          detail: `no secret provider named "${providerName}" is configured for this workspace`,
        }),
      );
    }

    const resolved = await resolveOneProvider(providerName, refs, row, state);
    if (resolved.isErr()) return resolved;
  }

  return Result.ok(true);
}

/**
 * Everything one provider owes this resolve: decrypt once, answer its
 * connection refs from the row, fetch the rest.
 *
 * Split out of `loadVaultValues` to keep that function under the complexity
 * cap once connection refs joined it. The split is also where the ordering
 * matters: connection refs resolve BEFORE the network call, so they still
 * resolve when the provider is unreachable.
 */
async function resolveOneProvider(
  providerName: string,
  refs: Set<string>,
  row: VaultProviderRecord,
  state: VaultResolveState,
): Promise<Result<true, VaultResolveError>> {
  // `otterdeploy/*` addresses the CONNECTION's own credentials, not a secret
  // stored in it, so those refs never reach the provider API.
  const connectionRefs = [...refs].filter(isConnectionRef);
  const secretRefs = [...refs].filter((ref) => !isConnectionRef(ref));

  let fetched: Map<string, string>;
  let connectionValues: Map<string, string>;
  try {
    // Decrypt inside the try: a malformed/rotated-away ciphertext should
    // surface as an actionable resolve failure, not an unhandled 500.
    const credential = await decryptForDomain(row.credentialCiphertext, "vault-creds");

    const resolved = resolveConnectionRefs(row, credential, connectionRefs);
    if (resolved.isErr()) {
      const { ref, detail } = resolved.error;
      return Result.err(new VaultResolveError({ providerName, ref, detail }));
    }
    connectionValues = resolved.value;

    fetched =
      secretRefs.length > 0
        ? await getSecrets(
            { name: row.name, kind: row.kind, config: row.configJson, credential },
            secretRefs,
          )
        : new Map();
  } catch (err) {
    return Result.err(
      new VaultResolveError({
        providerName,
        ref: [...refs][0] ?? "",
        detail: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  for (const [ref, value] of connectionValues) {
    state.values.set(vaultValueKey(providerName, ref), value);
  }

  for (const ref of secretRefs) {
    const value = fetched.get(ref);
    if (value === undefined) {
      return Result.err(
        new VaultResolveError({
          providerName,
          ref,
          detail: `provider returned no value for "${ref}"`,
        }),
      );
    }
    state.values.set(vaultValueKey(providerName, ref), value);
  }

  return Result.ok(true);
}

/** Resolve every connection ref, or the first one that cannot be. Values are
 *  returned rather than written straight into the state so a later failure in
 *  the same provider cannot leave half its refs resolved. */
function resolveConnectionRefs(
  row: VaultProviderRecord,
  credential: string,
  refs: string[],
): Result<Map<string, string>, { ref: string; detail: string }> {
  const values = new Map<string, string>();
  for (const ref of refs) {
    const resolved = resolveConnectionRef(
      { kind: row.kind, config: row.configJson, credential },
      ref,
    );
    if (!resolved.ok) return Result.err({ ref, detail: resolved.detail });
    values.set(ref, resolved.value);
  }
  return Result.ok(values);
}
