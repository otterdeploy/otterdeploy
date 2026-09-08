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
 * Credentials ISSUED BY SOMEONE ELSE, which the platform must never invent.
 *
 * This is the distinction the rest of this file was missing, and it is not
 * "is it a secret" - it is WHO ISSUES IT:
 *
 *   * A self-contained secret has both sides inside the stack.
 *     `POSTGRES_PASSWORD` is whatever we say it is, because the same value is
 *     handed to the database and to the app. Generating it is exactly right,
 *     and is the whole point of this module.
 *   * A vendor-issued credential is minted by a third party.
 *     `RESEND_API_KEY` is valid only if Resend issued it. A generated one is
 *     32 plausible random characters that will never authenticate.
 *
 * Filling the second kind is worse than leaving it blank, and worse in the
 * specific way that is hardest to debug: the field LOOKS answered, the operator
 * has no reason to revisit it, the container boots fine, and the feature is
 * silently dead until someone notices no email ever arrived. Blank is a
 * question. A fake key is a wrong answer that nothing contradicts.
 *
 * This file already made exactly this argument for `LICENSE_KEY` and
 * `SSH_KEY` - "a field that LOOKS filled and is guaranteed invalid, which is
 * worse than leaving it blank" - but the exclusion guarded only the `KEY_RE`
 * branch. `RESEND_API_KEY` matches `SECRET_RE` on `API_?KEY` first and never
 * reached it (od-uini).
 *
 * The classification stays `secret` either way: these ARE credentials and must
 * still be masked. Only the FILLING changes, which is why this is a separate
 * question from `classifyEnvVar` rather than a fourth kind.
 */

/**
 * Named third parties. Deliberately a list rather than a pattern: there is no
 * shape that distinguishes `RESEND_API_KEY` from `MEILI_MASTER_KEY`, only
 * knowledge of what Resend and Meilisearch are.
 *
 * Bounded to a whole segment so `OPENAI_API_KEY` matches and a self-hosted
 * `MYOPENAI_KEY` does not.
 */
const VENDOR_RE =
  /(^|_)(RESEND|SENDGRID|MAILGUN|POSTMARK|MAILCHIMP|BREVO|SES|TWILIO|VONAGE|STRIPE|PADDLE|LEMONSQUEEZY|POLAR|PLAID|OPENAI|ANTHROPIC|GEMINI|MISTRAL|COHERE|GROQ|REPLICATE|HUGGINGFACE|AWS|GCP|GOOGLE|AZURE|CLOUDFLARE|VERCEL|NETLIFY|FLY|RAILWAY|RENDER|HEROKU|DIGITALOCEAN|HETZNER|LINODE|VULTR|SCALEWAY|GITHUB|GITLAB|BITBUCKET|SLACK|DISCORD|TELEGRAM|SENTRY|DATADOG|NEWRELIC|HONEYCOMB|POSTHOG|AMPLITUDE|MIXPANEL|SEGMENT|ALGOLIA|PINECONE|CLERK|AUTH0|OKTA|SUPABASE|FIREBASE|NGROK|TAILSCALE|NETBIRD|INFISICAL|DOPPLER|CLOUDINARY|UPLOADTHING|MAPBOX|RECAPTCHA|TURNSTILE)($|_)/i;

/**
 * Shapes that name a credential belonging to whatever service the key points
 * at, even when the vendor is not one we listed.
 *
 * `API_KEY`, `ACCESS_KEY` and `DSN` are the three that are almost never
 * self-issued: something already exists, and this is how you authenticate TO
 * it. `CLIENT_ID`/`CLIENT_SECRET` are an OAuth pair, always issued by the
 * provider you are integrating with.
 *
 * The asymmetry is deliberate and worth stating, because this WILL occasionally
 * refuse to fill something that was self-issued (a self-hosted LiveKit lets you
 * choose `LIVEKIT_API_KEY`). That costs one edit on a field that is visibly
 * blank and marked required. The other error - generating a Stripe key - costs
 * a silent outage nobody is looking for. When in doubt, do not invent.
 */
const ISSUED_SHAPE_RE = /(^|_)(API_?KEYS?|ACCESS_?KEYS?|DSN|CLIENT_ID|CLIENT_SECRET)($|_)/i;

/**
 * Is this a credential only a third party can issue?
 *
 * Only meaningful for keys that classify as `secret`; a URL or a plain value
 * was never going to be generated anyway.
 */
export function isVendorIssuedKey(key: string): boolean {
  return VENDOR_RE.test(key) || ISSUED_SHAPE_RE.test(key);
}

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

/**
 * Can the platform produce a value without asking?
 *
 * Must agree with `autofillValue` exactly. This drives the templates catalog
 * copy ("we fill this in for you"), so a key that says yes here and then
 * resolves to null there promises the operator a value that never arrives.
 */
export function isAutofilledKey(key: string): boolean {
  const kind = classifyEnvVar(key);
  if (kind === "plain") return false;
  return !(kind === "secret" && isVendorIssuedKey(key));
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
      // A credential someone else issues cannot be invented. See
      // `isVendorIssuedKey`: a blank field asks a question, a generated one
      // gives a wrong answer that nothing will contradict until the feature is
      // found dead.
      return isVendorIssuedKey(key) ? null : ctx.randomSecret();
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
