/**
 * Resolve `${{vault.<provider>.<ref>}}` inside the project variables a compose
 * stack interpolates against (od-i3p).
 *
 * A compose file reads project variables through shell-style `${VAR}`, and
 * `routers/compose/env.ts` substitutes them into EVERY string field: image,
 * command, entrypoint, ports, env. Its regex is `${VAR}` and does not match
 * `${{vault…}}` at all, so a vault token sitting in a project variable's VALUE
 * was inlined verbatim — the container got the literal text `${{vault.p.r}}`
 * as its image tag or its command.
 *
 * The env half already worked and is deliberately untouched: a vault token in
 * a compose service's env passes through unchanged into the service_env_var
 * row, and `resolveServiceEnv` resolves it at deploy. This closes the half
 * that never reaches that resolver.
 *
 * Best-effort by design. A provider outage must not fail a deploy whose
 * variables happen to mention a vault; the unresolved value is left as written
 * and surfaces the same way it does today, rather than taking the stack down.
 */
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import { parseValue } from "../../lib/variables/parser";
import { substituteTokens } from "../../lib/variables/substitute";
import { createVaultState, loadVaultValues } from "../../lib/variables/vault-resolve";

export async function resolveVaultInProjectVars(
  vars: Record<string, string>,
  organizationId: string | null,
  log?: RequestLogger,
): Promise<Record<string, string>> {
  const candidates = Object.entries(vars).filter(([, v]) => v.includes("${{vault."));
  if (candidates.length === 0) return vars;

  const state = createVaultState(organizationId);
  const parsed: Array<{ key: string; tokens: ReturnType<typeof parseValue> }> = candidates.map(
    ([key, value]) => ({ key, tokens: parseValue(value) }),
  );
  const allTokens = parsed.flatMap((p) => (p.tokens.ok ? p.tokens.tokens : []));

  const loaded = await loadVaultValues(allTokens, state);
  if (loaded.isErr()) {
    log?.set({ compose: { step: "vault-project-vars", error: loaded.error.message } });
    return vars;
  }

  const out = { ...vars };
  for (const { key, tokens } of parsed) {
    if (!tokens.ok) continue;
    // No ref resolver: a project variable reading ANOTHER resource is not a
    // thing the compose path supports, and inventing it here would resolve
    // half of a grammar the rest of this file does not speak.
    const subbed = await substituteTokens(tokens.tokens, state, () =>
      Promise.resolve(Result.ok({})),
    );
    if (subbed.isOk()) out[key] = subbed.value;
  }
  return out;
}
