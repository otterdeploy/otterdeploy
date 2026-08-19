/**
 * The pure half of env-var resolution: token-by-token substitution and the
 * env-row overlay. Split out of resolver.ts (line cap) with the resource
 * loader INJECTED rather than imported — resolver.ts already sits inside a
 * pre-existing import-cycle family through the query modules, and a sibling
 * that imported them too would add parallel cycle paths (measured, not
 * hypothetical). Everything imported here is a leaf.
 */
import { Result } from "better-result";

import type { RefToken, Token } from "./parser";
import type { VaultResolveState } from "./vault-resolve";

import { RefUnknownVarError, type ResolveError } from "../../routers/service/errors";
import { vaultValueFor } from "./vault-resolve";

/**
 * A service's env rows for the active environment, in precedence order:
 *   legacy NULL-env rows  <  active-env rows
 * (later overrides earlier, by key). NULL-env rows are pre-backfill leftovers
 * treated as a universal fallback, so production resolves identically before
 * the environment backfill runs. Structural generic so this stays import-free.
 */
export function overlayServiceEnv<T extends { key: string; environmentId: string | null }>(
  rows: T[],
  environmentId: string,
): T[] {
  const byKey = new Map<string, T>();
  for (const r of rows) if (r.environmentId == null) byKey.set(r.key, r);
  for (const r of rows) if (r.environmentId === environmentId) byKey.set(r.key, r);
  return [...byKey.values()];
}

/** Rebuild one value from its tokens. Literals pass through, vault tokens
 *  read the batch-prefetched state, resource refs go through `loadRef`
 *  (which owns lookup, cycle detection, and caching). */
export async function substituteTokens(
  tokens: Token[],
  vault: VaultResolveState,
  loadRef: (token: RefToken) => Promise<Result<Record<string, string>, ResolveError>>,
): Promise<Result<string, ResolveError>> {
  let out = "";

  for (const token of tokens) {
    if (token.kind === "literal") {
      out += token.value;
      continue;
    }

    if (token.kind === "vault") {
      // Batch-fetched by loadVaultValues before substitution began.
      const value = vaultValueFor(token, vault);
      if (value.isErr()) return Result.err(value.error);
      out += value.value;
      continue;
    }

    const exportsResult = await loadRef(token);
    if (exportsResult.isErr()) return Result.err(exportsResult.error);

    const value = exportsResult.value[token.var];
    if (value === undefined) {
      return Result.err(
        new RefUnknownVarError({ refResourceName: token.resource, refVarName: token.var }),
      );
    }
    out += value;
  }

  return Result.ok(out);
}
