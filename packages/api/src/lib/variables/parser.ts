/**
 * Parses Railway-style variable references in env-var values.
 *
 *   ${{<ResourceName>.<VAR>}}            — another resource's export
 *   ${{<Stack>.<Service>.<VAR>}}         — a compose stack's child, by the
 *                                          stack's resource name + the child's
 *                                          COMPOSE service key
 *   ${{stack.<Service>.<VAR>}}           — sibling child of the REFERENCING
 *                                          service's own stack. The form
 *                                          templates ship with: it survives
 *                                          instance renames (autumn-2) that
 *                                          break any absolute name
 *   ${{vault.<provider>.<ref>}}          — an external secret manager
 *   ${{vault.<provider>.otterdeploy/<f>}} — that provider CONNECTION's own
 *                                          credentials (the bootstrap pair an
 *                                          app needs to authenticate to the
 *                                          manager itself). `otterdeploy/` is a
 *                                          RESERVED ref prefix, resolved from
 *                                          the stored row instead of fetched;
 *                                          see ./vault-connection-ref.ts
 *
 * Escaping: `\${{` becomes a literal `${{` in the output.
 *
 *   ResourceName  matches [A-Za-z][A-Za-z0-9_-]*
 *   VAR           matches [A-Z_][A-Z0-9_]*
 *   provider      matches [a-z0-9][a-z0-9_-]*   (contract-enforced slug)
 *   ref           matches [A-Za-z0-9_\-./:]+    (provider-specific free text,
 *                 e.g. a Vault `path:field` or an Infisical secret key)
 *
 * The vault form only engages when the first segment is literally `vault`
 * AND what follows parses as `<provider>.<ref>` — so a resource actually
 * named "vault" keeps resolving its own `${{vault.SOME_VAR}}` exports. The
 * two- vs three-segment split is structural, not keyword-based: VAR is
 * SCREAMING_SNAKE and must be the FINAL segment before `}}`, so `a.HOST` is a
 * flat ref while `a.b.HOST` is a stack-scoped one (and `a.B.HOST` too — the
 * middle segment failing to terminate the token is what disqualifies the
 * flat reading).
 */

export interface RefToken {
  kind: "ref";
  /** Flat form: the referenced resource's name. Stack form: the child's
   *  COMPOSE service key within `stack`. */
  resource: string;
  /** Absent → flat ref. `{ name: null }` → the referencing service's own
   *  stack (`stack.` scope). `{ name: "autumn" }` → that stack by resource
   *  name. */
  stack?: { name: string | null };
  var: string;
  raw: string; // original substring including `${{` and `}}`
}

export interface VaultToken {
  kind: "vault";
  /** The configured provider's name (`vault_provider.name`). */
  provider: string;
  /** Provider-specific secret reference (path:field / key). */
  ref: string;
  raw: string; // original substring including `${{` and `}}`
}

export interface LiteralToken {
  kind: "literal";
  value: string;
}

export type Token = RefToken | VaultToken | LiteralToken;

export interface ParseError {
  kind: "parse_error";
  message: string;
  position: number;
}

export type ParseResult = { ok: true; tokens: Token[] } | { ok: false; error: ParseError };

const RESOURCE_NAME = /^[A-Za-z][A-Za-z0-9_-]*/;
const VAR_NAME = /^[A-Z_][A-Z0-9_]*/;
// Matches the provider slug enforced by the vault-provider contract
// (`^[a-z0-9][a-z0-9_-]{0,63}$`). Deliberately lowercase-only: that's what
// disambiguates `${{vault.myprov.…}}` from `${{vault.SOME_VAR}}` on a
// resource that happens to be named "vault".
const PROVIDER_NAME = /^[a-z0-9][a-z0-9_-]*/;
// Provider-specific refs are free-ish text: Vault paths with `/` and a
// `:field` suffix, dotted or dashed keys. `}` is excluded so `}}` still
// terminates the token.
const VAULT_REF = /^[A-Za-z0-9_\-./:]+/;

type TokenParse =
  | { ok: true; token: RefToken | VaultToken; next: number }
  | { ok: false; error: ParseError };

const fail = (message: string, position: number): TokenParse => ({
  ok: false,
  error: { kind: "parse_error", message, position },
});

/**
 * The vault tail: `<provider>.<ref>}}`, positioned just after `${{vault.`.
 *
 * Returns null (not an error) when what follows isn't a provider slug plus a
 * `.`, so the caller can fall back to the two-segment resource form and a
 * resource genuinely named "vault" keeps resolving `${{vault.MY_VAR}}` as its
 * own export.
 */
function parseVaultTail(input: string, start: number, at: number): TokenParse | null {
  const providerMatch = input.slice(at).match(PROVIDER_NAME);
  if (!providerMatch || input[at + providerMatch[0].length] !== ".") return null;

  const provider = providerMatch[0];
  let i = at + provider.length + 1; // provider + "."

  const refMatch = input.slice(i).match(VAULT_REF);
  if (!refMatch) {
    return fail("expected a secret reference after the vault provider name", i);
  }
  const ref = refMatch[0];
  i += ref.length;

  if (!input.startsWith("}}", i)) return fail("expected closing `}}`", i);
  i += 2;

  return {
    ok: true,
    token: { kind: "vault", provider, ref, raw: input.slice(start, i) },
    next: i,
  };
}

/**
 * The stack-scoped tail: `<Service>.<VAR>}}`, positioned just after
 * `${{<Stack>.`. Reached only once the flat two-segment reading has been
 * ruled out (VAR must be the FINAL segment).
 */
function parseStackTail(
  input: string,
  start: number,
  at: number,
  stackSegment: string,
): TokenParse {
  const serviceMatch = input.slice(at).match(RESOURCE_NAME);
  if (!serviceMatch || input[at + serviceMatch[0].length] !== ".") {
    return fail("expected SCREAMING_SNAKE_CASE variable name", at);
  }
  const service = serviceMatch[0];
  let i = at + service.length + 1; // service + "."

  const varMatch = input.slice(i).match(VAR_NAME);
  if (!varMatch) return fail("expected SCREAMING_SNAKE_CASE variable name", i);
  const varName = varMatch[0];
  i += varName.length;

  if (!input.startsWith("}}", i)) return fail("expected closing `}}`", i);
  i += 2;

  return {
    ok: true,
    token: {
      kind: "ref",
      resource: service,
      // The literal first segment `stack` is the self scope; anything else
      // names a stack resource. A stack actually NAMED "stack" is
      // unaddressable absolutely — rename it; the self scope wins.
      stack: { name: stackSegment === "stack" ? null : stackSegment },
      var: varName,
      raw: input.slice(start, i),
    },
    next: i,
  };
}

/** One whole `${{…}}` token, whose `${{` begins at `start`. */
function parseToken(input: string, start: number): TokenParse {
  let i = start + 3;

  const firstMatch = input.slice(i).match(RESOURCE_NAME);
  if (!firstMatch) return fail("expected resource name after `${{`", i);
  const first = firstMatch[0];
  i += first.length;

  if (input[i] !== ".") return fail("expected `.` between resource and variable name", i);
  i += 1;

  if (first === "vault") {
    const vault = parseVaultTail(input, start, i);
    if (vault) return vault;
  }

  // Flat form: `<ResourceName>.<VAR>}}`. VAR must be the final segment, so a
  // middle segment that doesn't close the token falls through to the
  // stack-scoped reading.
  const varMatch = input.slice(i).match(VAR_NAME);
  if (varMatch && input.startsWith("}}", i + varMatch[0].length)) {
    const varName = varMatch[0];
    const next = i + varName.length + 2;
    return {
      ok: true,
      token: { kind: "ref", resource: first, var: varName, raw: input.slice(start, next) },
      next,
    };
  }

  return parseStackTail(input, start, i, first);
}

export function parseValue(input: string): ParseResult {
  const tokens: Token[] = [];
  let literal = "";
  let i = 0;

  const flushLiteral = () => {
    if (literal.length > 0) {
      tokens.push({ kind: "literal", value: literal });
      literal = "";
    }
  };

  while (i < input.length) {
    // Escaped reference: \${{ → literal ${{
    if (input[i] === "\\" && input.startsWith("${{", i + 1)) {
      literal += "${{";
      i += 4;
      continue;
    }

    if (input.startsWith("${{", i)) {
      const parsed = parseToken(input, i);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      flushLiteral();
      tokens.push(parsed.token);
      i = parsed.next;
      continue;
    }

    literal += input[i];
    i += 1;
  }

  flushLiteral();
  return { ok: true, tokens };
}

/** Convenience: list every vault reference in a value, deduplicated by
 *  (provider, ref). Resource refs are `extractRefs`; the two stay separate
 *  because vault refs never participate in the dependency graph. */
export function extractVaultRefs(input: string): VaultToken[] {
  const result = parseValue(input);
  if (!result.ok) return [];
  const seen = new Set<string>();
  const refs: VaultToken[] = [];
  for (const token of result.tokens) {
    if (token.kind !== "vault") continue;
    const key = `${token.provider} ${token.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(token);
  }
  return refs;
}

/** Convenience: list every RESOURCE reference in a value, deduplicated by
 *  (resource, var). Vault tokens are deliberately excluded — they are not
 *  project resources and must not create graph edges. */
export function extractRefs(input: string): RefToken[] {
  const result = parseValue(input);
  if (!result.ok) return [];
  const seen = new Set<string>();
  const refs: RefToken[] = [];
  for (const token of result.tokens) {
    if (token.kind !== "ref") continue;
    const scope = token.stack ? `${token.stack.name ?? "<self>"}/` : "";
    const key = `${scope}${token.resource}.${token.var}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(token);
  }
  return refs;
}
