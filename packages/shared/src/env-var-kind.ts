/**
 * Classify a compose `${VAR}` by what the platform can fill in for the
 * operator. One source of truth, because two surfaces disagreed about the same
 * variable: the template detail modal told operators to run
 * `openssl rand -base64 32` for `APP_SECRET`, two clicks before a wizard step
 * whose own copy reads "secrets are auto-generated, defaults pre-filled".
 *
 * Both the wizard (which seeds the value) and the templates catalog UI (which
 * describes what the operator will have to supply) read this, so they cannot
 * drift again. It lives in @otterdeploy/shared rather than in the web app
 * because the template generator will eventually need it server-side to mark
 * each `requiredEnv` entry autofilled: see docs/designs/template-registry.md.
 *
 * This is a heuristic on the KEY NAME, deliberately. The common alternative
 * (magic template prefixes like `SERVICE_PASSWORD_X`, `SERVICE_FQDN_X`) only
 * fires when a template author wrote the prefix, so a pasted third-party
 * compose file gets nothing.
 * Matching on the name means any compose file benefits with zero authoring -
 * at the cost of the occasional miss (`ROOT_PW`) or false positive. Every
 * seeded value stays editable, so a wrong guess costs an edit, never a deploy.
 */

/** Credential-looking keys, filled with a strong random value, masked. */
const SECRET_RE =
  /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|API_?KEY|ACCESS_?KEY|CREDENTIAL|DSN|SALT|WEBHOOK|SIGNING)/i;

/**
 * `AUTH` is a credential only as a WHOLE WORD.
 *
 * It used to sit in `SECRET_RE` as a bare substring, which made every key of
 * any product with "auth" in its name a secret: Authentik's stack masked
 * `AUTHENTIK_POSTGRESQL__NAME` and `__USER` (a database name and a username)
 * while the URL-precedence rule below existed only to rescue `NEXTAUTH_URL`
 * from the same over-match. Bounding the token fixes the cause; the real
 * credentials still match on their own terms (`AUTHENTIK_SECRET_KEY` via
 * SECRET, `AUTH_TOKEN` via TOKEN, `BASIC_AUTH_PASSWORD` via PASSWORD).
 */
const AUTH_RE = /(^|_)AUTH($|_)/i;

/**
 * `…_KEY` is a credential too. `N8N_ENCRYPTION_KEY`, `MEILI_MASTER_KEY`,
 * `TOTP_VAULT_KEY` all went unfilled because the pattern above only knows
 * `API_KEY`/`ACCESS_KEY`.
 *
 * Plural counts. LiveKit hands its whole credential set to `LIVEKIT_KEYS`
 * (`key: secret`), and the singular-only pattern classified that `plain`, so
 * an API secret rendered in the clear in the variables editor while
 * `MEILI_MASTER_KEY` beside it was masked.
 *
 * The exclusions matter more than the rule. A `LICENSE_KEY` comes from a
 * vendor and a `PUBLIC_KEY`/`SSH_KEY` from the operator's own keyring;
 * generating random bytes for those would produce a field that LOOKS filled
 * and is guaranteed invalid, which is worse than leaving it blank. Blank at
 * least tells the truth.
 */
const KEY_RE = /(^|_)KEYS?($|_)|[A-Z0-9]_KEYS?$/i;

/**
 * Password spellings the main pattern misses: `MASTERPASS`, `DB_PASS`,
 * `PASSPHRASE`. Word-bounded so `BYPASS` and `COMPASS` stay plain.
 */
const PASS_RE = /(^|_)(PASS|MASTERPASS|PASSPHRASE)($|_)/i;
const NOT_A_GENERATED_KEY_RE = /(LICENSE|LICENCE|PUBLIC|SSH|HOST|PGP|GPG|DEPLOY)_?KEY/i;

/**
 * Keys wanting the address this stack will be reachable at.
 *
 * Ordered narrower-than-`SECRET_RE` on purpose: `AUTH` matches the secret
 * pattern, so `NEXTAUTH_URL` would be masked and filled with random bytes
 * without the precedence rule in {@link classifyEnvVar}. A URL is not a
 * secret, and hiding one behind a reveal toggle is actively unhelpful.
 */
const URL_RE = /(^|_)(URL|URI|ORIGIN|FQDN|DOMAIN|HOSTNAME|ENDPOINT|SITE|BASE)($|_)/i;

/** Keys that name a host without a scheme: `SERVER_HOST`, `PUBLIC_HOST`. */
const HOST_RE = /(^|_)HOST($|_)/i;

export type EnvVarKind = "secret" | "url" | "host" | "plain";

/**
 * What the platform can fill in.
 *
 *   secret: a strong random value
 *   url: `https://<the FQDN this stack will publish at>`
 *   host: that FQDN, bare
 *   plain, nothing; the operator has to know this one
 *
 * URL/host win over secret so `NEXTAUTH_URL` and `AUTH_DOMAIN` are treated as
 * addresses rather than credentials.
 */
export function classifyEnvVar(key: string): EnvVarKind {
  if (URL_RE.test(key)) return "url";
  if (HOST_RE.test(key)) return "host";
  if (SECRET_RE.test(key) || AUTH_RE.test(key)) return "secret";
  if (KEY_RE.test(key) && !NOT_A_GENERATED_KEY_RE.test(key)) return "secret";
  if (PASS_RE.test(key)) return "secret";
  return "plain";
}

/** Should this value be masked in the UI? Only true secrets. */
export function isSecretKey(key: string): boolean {
  return classifyEnvVar(key) === "secret";
}

/** Can the platform produce a value without asking? */
export function isAutofilledKey(key: string): boolean {
  return classifyEnvVar(key) !== "plain";
}

/**
 * The value to seed, given the public FQDN the stack will publish at.
 * `null` when the platform can't fill this one, or when the host isn't known
 * yet (no exposed service): the caller falls back to leaving it blank.
 *
 * When `frontService` names the stack's exposed front door, an address is
 * seeded as a REFERENCE to that service's public address rather than as the
 * hostname itself. This is the difference between a value that tracks the
 * stack and one that freezes at install time. A literal is resolved once, at
 * create, and then nothing updates it: rename the domain in Settings and the
 * route moves while the app goes on advertising the host it was born with —
 * a frontend served on the new domain calling an API on the old one, which
 * fails as CORS in the browser and looks like a networking bug rather than a
 * stale string. `${{stack.<svc>.PUBLIC_URL}}` re-resolves on every deploy, and
 * the domain mutations fan a redeploy out to everything that reads it, so the
 * address the operator sets is the address the app is told, always.
 *
 * `publicHost` remains the fallback for a stack with no identified front
 * service, where there is nothing to reference and a literal is all we have.
 */
export function autofillValue(
  key: string,
  ctx: {
    randomSecret: () => string;
    publicHost: string | null;
    /** Compose service key of the exposed front door, when it is actually
     *  being exposed. Omitted → seed the literal host. */
    frontService?: string | null;
  },
): string | null {
  const ref = ctx.frontService;
  switch (classifyEnvVar(key)) {
    case "secret":
      return ctx.randomSecret();
    case "url":
      if (ref) return `\${{stack.${ref}.PUBLIC_URL}}`;
      return ctx.publicHost ? `https://${ctx.publicHost}` : null;
    case "host":
      if (ref) return `\${{stack.${ref}.DOMAIN}}`;
      return ctx.publicHost;
    case "plain":
      return null;
  }
}
