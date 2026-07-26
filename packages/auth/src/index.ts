import type { IdPrefix } from "@otterdeploy/shared/id";

import { apiKey } from "@better-auth/api-key";
import { db } from "@otterdeploy/db";
import * as schema from "@otterdeploy/db/schema";
import {
  invitation,
  member,
  session as sessionTbl,
  user as userTbl,
} from "@otterdeploy/db/schema/auth";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { OrganizationInvitationEmail, sendEmail } from "@otterdeploy/email";
import { env } from "@otterdeploy/env/server";
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { bearer, deviceAuthorization, organization, twoFactor } from "better-auth/plugins";
import { Result } from "better-result";
import { and, asc, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { log } from "evlog";

import { createAuthAuditHook } from "./audit";
import { ac, roles } from "./permissions";
import { resolveSocialProviders, toBetterAuthSocialProviders } from "./platform-config";
import { BOOTSTRAP_TOKEN_HEADER, decideRegistration } from "./registration-policy";
import { resolveCanonicalWebOrigin } from "./web-origin";

/**
 * Pick the org to make active on a fresh session. Prefers the org from the
 * user's most recent prior session that is still a current membership;
 * falls back to their oldest membership; returns null if they have none
 * (the /_app layout will route them to onboarding).
 */
async function resolveActiveOrganizationId(userId: string): Promise<string | null> {
  const [lastActive] = await db
    .select({ orgId: sessionTbl.activeOrganizationId })
    .from(sessionTbl)
    .innerJoin(
      member,
      and(
        eq(member.userId, sessionTbl.userId),
        eq(member.organizationId, sessionTbl.activeOrganizationId),
      ),
    )
    .where(and(eq(sessionTbl.userId, userId), isNotNull(sessionTbl.activeOrganizationId)))
    .orderBy(desc(sessionTbl.updatedAt))
    .limit(1);

  if (lastActive?.orgId) return lastActive.orgId;

  const [firstMembership] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt))
    .limit(1);

  return firstMembership?.organizationId ?? null;
}

/**
 * Env-seeded social providers — the set used to build the FIRST auth instance,
 * before the database is reachable. Included only when both halves of a
 * credential are present, so an unconfigured provider is a clean no-op.
 * Distinct from the GitHub *App* used for git providers.
 *
 * Once the server has booted, `reloadAuth()` replaces this with the resolved
 * DB-or-env set (see ./platform-config.ts) — the env values remain the
 * fallback for any provider the operator has not configured in the UI.
 */
const envSocialProviders = {
  ...(env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET
    ? {
        github: {
          clientId: env.GITHUB_OAUTH_CLIENT_ID,
          clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
        },
      }
    : {}),
  ...(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET
    ? {
        google: {
          clientId: env.GOOGLE_OAUTH_CLIENT_ID,
          clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        },
      }
    : {}),
  ...(env.GITLAB_OAUTH_CLIENT_ID && env.GITLAB_OAUTH_CLIENT_SECRET
    ? {
        gitlab: {
          clientId: env.GITLAB_OAUTH_CLIENT_ID,
          clientSecret: env.GITLAB_OAUTH_CLIENT_SECRET,
          ...(env.GITLAB_OAUTH_ISSUER ? { issuer: env.GITLAB_OAUTH_ISSUER } : {}),
        },
      }
    : {}),
};

/**
 * Registration surface the sign-in page renders:
 *   "bootstrap"   — no account exists yet; offer the bootstrap-token form.
 *   "open"        — operator allows self-registration; offer plain sign-up.
 *   "invite-only" — sign-up only reachable through an invitation link.
 */
export type RegistrationMode = "bootstrap" | "invite-only" | "open";

export async function getRegistrationMode(): Promise<RegistrationMode> {
  const [[existingUser], [installation]] = await Promise.all([
    db.select({ id: userTbl.id }).from(userTbl).limit(1),
    db
      .select({
        bootstrapCompletedAt: platformSettings.bootstrapCompletedAt,
        registrationMode: platformSettings.registrationMode,
      })
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .limit(1),
  ]);
  if (!existingUser && !installation?.bootstrapCompletedAt) return "bootstrap";
  return installation?.registrationMode === "open" ? "open" : "invite-only";
}

// Cookie security must track the scheme the platform is actually served over.
// Hardcoding Secure + SameSite=None breaks the common self-hosted case of a
// plain http://<ip>:<port> dashboard (no TLS): browsers DROP a Secure /
// SameSite=None cookie on a non-HTTPS origin, so sign-in returns 200 but every
// get-session comes back null (the session cookie is never stored or sent) and
// the app can never see a session — the user is stuck on the sign-in page.
const servedOverHttps = env.BETTER_AUTH_URL.startsWith("https://");

type SocialProvidersConfig = Record<
  string,
  { clientId: string; clientSecret: string; issuer?: string }
>;

function buildAuth(socialProviders: SocialProvidersConfig) {
  return betterAuth({
    appName: "otterdeploy",
    // Social sign-in + account linking, so signing in with a provider whose
    // email matches an existing account links to it rather than erroring or
    // creating a duplicate. The set is resolved at build time from the DB (with
    // env as the fallback) and swapped in wholesale by `reloadAuth()`.
    socialProviders,
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["github", "google", "gitlab"],
      },
    },
    user: {
      additionalFields: {
        // Server-owned and returned with sessions so every transport can enforce
        // installation authority without interpreting an organization role.
        // No `fieldName` override: the drizzle adapter's getFieldName() treats
        // that as the SCHEMA OBJECT'S key to look up (schema.user.fields.<js
        // key>.fieldName), not the SQL column name — schema/auth.ts already
        // declares `isInstallAdmin: boolean("is_install_admin")`, i.e. the JS
        // key IS "isInstallAdmin" and drizzle owns the snake_case SQL column
        // name on its own. Setting fieldName here to the SQL name made the
        // adapter look for a `schema.user["is_install_admin"]` property that
        // doesn't exist, so every signup 500'd with "The field
        // \"is_install_admin\" does not exist in the \"user\" Drizzle schema" —
        // caught by the real-Postgres integration suite (od-5j8.1.1), never by
        // the pure decideRegistration() unit tests.
        isInstallAdmin: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
          returned: true,
        },
      },
    },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: schema,
    }),
    rateLimit: {
      enabled: true,
      window: 60, // time window in seconds
      max: 100, // max requests in the window
    },
    // `experimental.joins` would let the Drizzle adapter use the RQB
    // v2 query builder (`db.query.user.findFirst({ with: { session } })`).
    // That requires `relations` passed to drizzle() in
    // packages/db/src/client.ts, which is intentionally not wired today.
    // The adapter falls back to plain selects without it.
    // Trust the request's OWN origin — the exact scheme AND host the client used —
    // but only when the Origin header's host matches the Host header, i.e. a
    // genuine same-origin request. A self-hosted box is reachable at many names
    // (public IP, LAN IP, hostname, tunnel) and the operator shouldn't have to
    // enumerate them to avoid "Invalid origin" on POSTs. Echoing the Origin
    // verbatim preserves its protocol (HTTPS stays HTTPS, HTTP stays HTTP) instead
    // of guessing or trusting both. Still CSRF-safe: a cross-site attacker's
    // Origin host won't match our Host, so it isn't trusted (and the SameSite=Lax
    // session cookie isn't sent cross-site either). CORS_ORIGIN stays trusted for
    // any explicitly configured / split-origin cases.
    trustedOrigins: (request) => {
      const trusted = [...env.CORS_ORIGIN];
      const origin = request?.headers.get("origin");
      const host = request?.headers.get("host");
      // Result.try keeps a malformed Origin from throwing; unwrapOr(null) then just
      // reads as "not same-origin", so it falls back to the configured origins.
      if (origin && host && Result.try(() => new URL(origin).host).unwrapOr(null) === host) {
        trusted.push(origin);
      }
      return trusted;
    },
    emailAndPassword: {
      enabled: true,
    },
    session: {
      // Cache the validated session (+ its enriched fields like
      // activeOrganizationId) in a short-lived signed cookie so the common-case
      // getSession() is a local cookie read instead of a Postgres round-trip.
      // Without this, EVERY RPC call (context.ts getSession) and EVERY app
      // navigation (the _app beforeLoad) revalidated the session against the DB
      // — the single biggest source of pervasive latency. The trade-off is that a
      // revoked session is honored for up to `maxAge`; 5 minutes is the standard
      // better-auth default for this window.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    advanced: {
      // Over HTTPS keep Secure + SameSite=None (also lets a split-origin/cross-site
      // deploy send the cookie). Over HTTP fall back to an insecure Lax cookie,
      // which the browser will actually store — correct for the same-origin
      // topology the server serves the dashboard from by default. See
      // `servedOverHttps` above.
      defaultCookieAttributes: {
        sameSite: servedOverHttps ? "none" : "lax",
        secure: servedOverHttps,
        httpOnly: true,
      },
      database: {
        // BA's "team" model is backed by the `project` table — emit project_ ids.
        generateId: ({ model }) => {
          const prefix =
            model === "team" ? ID_PREFIX.project : model === "organization" ? "org" : model;
          return createId(prefix as IdPrefix);
        },
      },
      ipAddress: {
        // The control plane sits behind Caddy, which forwards the caller in
        // `x-forwarded-for` — so `cf-connecting-ip` (a leftover example) resolved
        // to no IP at all here, leaving rate-limit buckets and audit rows blind.
        //
        // Trusting this header is only safe because `sanitizeForwardingHeaders`
        // runs as the very first middleware (apps/server/src/index.ts) and
        // DELETES `x-forwarded-for` unless the immediate TCP peer is in
        // TRUSTED_PROXIES. A direct caller therefore cannot choose the IP that
        // gets rate-limited or written to the audit trail; it just records none.
        // See packages/api/src/security/trusted-proxy.ts.
        ipAddressHeaders: ["x-forwarded-for"],
      },
    },

    // Durable audit rows for the identity surface: better-auth owns these routes,
    // so the oRPC audit middleware never sees them. See ./audit-policy.ts.
    hooks: {
      after: createAuthAuditHook({ resolveOrganizationId: resolveActiveOrganizationId }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (newUser, context) => {
            const [[existingUser], [installation]] = await Promise.all([
              db.select({ id: userTbl.id }).from(userTbl).limit(1),
              db
                .select({
                  bootstrapCompletedAt: platformSettings.bootstrapCompletedAt,
                  registrationMode: platformSettings.registrationMode,
                })
                .from(platformSettings)
                .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
                .limit(1),
            ]);
            const bootstrapComplete = Boolean(existingUser || installation?.bootstrapCompletedAt);
            const [pendingInvitation] = existingUser
              ? await db
                  .select({ id: invitation.id })
                  .from(invitation)
                  .where(
                    and(
                      eq(invitation.status, "pending"),
                      gt(invitation.expiresAt, new Date()),
                      sql`lower(${invitation.email}) = ${newUser.email.toLowerCase()}`,
                    ),
                  )
                  .limit(1)
              : [];

            const decision = decideRegistration({
              bootstrapComplete,
              hasPendingInvitation: Boolean(pendingInvitation),
              authPath: context?.path,
              configuredBootstrapToken: env.OTTERDEPLOY_BOOTSTRAP_TOKEN,
              presentedBootstrapToken: context?.headers?.get(BOOTSTRAP_TOKEN_HEADER) ?? undefined,
              // Read from the row we already fetched rather than a cached
              // resolver: closing registration must bind on the very next signup
              // attempt, and this hook is the only place it's enforced.
              openRegistration: installation?.registrationMode === "open",
            });

            if (!decision.allowed) {
              const message =
                decision.reason === "invite-required"
                  ? "Account creation requires a pending invitation."
                  : "The first account requires the installation bootstrap token.";
              throw new APIError("FORBIDDEN", { message });
            }

            return {
              data: {
                ...newUser,
                isInstallAdmin: decision.installAdmin,
              },
            };
          },
          after: async (createdUser) => {
            if (createdUser.isInstallAdmin !== true) return;
            const now = new Date();
            await db
              .insert(platformSettings)
              .values({ id: PLATFORM_SETTINGS_ID, bootstrapCompletedAt: now })
              .onConflictDoUpdate({
                target: platformSettings.id,
                set: { bootstrapCompletedAt: now },
              });
          },
        },
      },
      session: {
        create: {
          before: async (session) => ({
            data: {
              ...session,
              activeOrganizationId: await resolveActiveOrganizationId(session.userId),
            },
          }),
        },
      },
    },

    plugins: [
      // Honors `Authorization: Bearer <token>` on auth.api.getSession.
      // Required by deviceAuthorization so CLI clients can authenticate.
      bearer(),
      // TOTP two-factor auth (authenticator apps) + single-use backup codes.
      // Only applies to credential (email/password) accounts. The TOTP secret and
      // backup codes are encrypted at rest (BETTER_AUTH_SECRET) and stored in the
      // `two_factor` table; `user.twoFactorEnabled` flips true after the first
      // successful TOTP verification. On sign-in, an account with 2FA returns
      // `twoFactorRedirect` instead of a session until a code is verified.
      twoFactor({ issuer: "otterdeploy" }),
      // Workspace-scoped API keys. `references: "organization"` means a key is
      // owned by an org (referenceId = organizationId), not an individual user,
      // so any owner/admin can manage the workspace's keys — matching how every
      // other resource here is org-scoped. Keys are hashed at rest; the plaintext
      // is returned only once from `create`. `enableMetadata` lets us tag keys,
      // and `requireName` forces a human label so the list stays identifiable.
      // The matching `apikey` table lives in db/schema/auth.ts (schema: {} uses
      // the plugin's default field names).
      apiKey({
        references: "organization",
        defaultPrefix: "otter_",
        enableMetadata: true,
        requireName: true,
        schema: {},
      }),
      // OAuth 2.0 Device Authorization Grant (RFC 8628). The CLI requests a
      // user_code, prints it; the user approves it in a browser at the
      // verificationUri; the CLI polls /device/token and receives an
      // access_token used with bearer() above.
      deviceAuthorization({
        // Absolute URL pointed at the WEB origin (where /device is rendered),
        // not the API origin. In prod they're typically the same host; in dev
        // they diverge (api.otterdeploy.localhost vs. web.otterdeploy.localhost),
        // so a relative path would send users to the API server's /device,
        // which doesn't exist. We use the first CORS_ORIGIN as the web host.
        //
        // This value is only a FALLBACK. better-auth validates the option with
        // `verificationUri: z.string().optional()`, so it accepts a static
        // string evaluated at module load and no function/async resolution —
        // meaning it can't prefer the verified control-plane FQDN, and on a
        // default install it resolves to `http://<ip>:3000`.
        //
        // The server therefore rebases the emitted URLs onto the canonical
        // origin on the way out; see apps/server/src/handlers/auth/
        // device-origin.ts. Keep this fallback sane anyway — it's what ships if
        // that rewrite ever fails or is bypassed.
        verificationUri: `${(env.CORS_ORIGIN[0] ?? env.BETTER_AUTH_URL).replace(/\/$/, "")}/device`,
        // Accept any client_id for now — the CLI sends "otterdeploy-cli".
        // Tighten when we ship third-party integrations.
        validateClient: async () => true,
        // Required by the plugin's option schema even though the docs
        // example omits it — `schema` is declared without `.optional()`,
        // so leaving it out throws a ZodError at registration. Empty
        // object means "use the plugin's default table + field names"
        // (we hand-rolled the matching deviceCode table in db/schema/auth.ts).
        schema: {},
      }),
      organization({
        // Workspace creation is an installation concern. Invitees can join the
        // workspace they were invited to but cannot mint a new owner role.
        allowUserToCreateOrganization: async (user) => user.isInstallAdmin === true,
        organizationLimit: 10,
        // better-auth ≥1.6 defaults this to TRUE, which blocks an unverified
        // session from even VIEWING an invitation for its own email. This app
        // wires no email-verification flow at all (no sendVerificationEmail, no
        // requireEmailVerification — every account, including the owner's, stays
        // emailVerified=false forever), so with the default a self-hosted install
        // without SMTP deadlocks: an invitee who signs up via the shared invite
        // link can NEVER verify and can NEVER accept. Disable it — accepting
        // still requires a session whose email matches the invitation email.
        // Revisit if/when a real verification flow ships.
        requireEmailVerificationOnInvitation: false,
        // Invitations: an invite link expires after 48h if unaccepted; once
        // accepted, membership is permanent until revoked. Re-inviting the same
        // email cancels the prior pending invite so duplicates don't pile up.
        invitationExpiresIn: 60 * 60 * 48,
        cancelPendingInvitationsOnReInvite: true,
        sendInvitationEmail: async (data) => {
          // Build the accept link against the CANONICAL web origin (where
          // /accept-invite renders): the verified control-plane FQDN when the
          // operator has set one, else the env web origin. On a default
          // self-hosted install CORS_ORIGIN/BETTER_AUTH_URL hold the raw public
          // IP — the FQDN keeps that IP out of invite emails. Never throws
          // (falls back to env), so a settings hiccup can't fail inviteMember.
          const webOrigin = await resolveCanonicalWebOrigin();
          const inviteUrl = `${webOrigin}/accept-invite/${data.invitation.id}`;
          // Non-fatal by design: the invitation row is already persisted before
          // this runs, so a failed email send (e.g. missing/placeholder
          // RESEND_API_KEY in dev) must NOT fail inviteMember. Swallow the error
          // and log the accept link for out-of-band delivery; the invite still
          // shows in the org's pending list either way.
          try {
            await sendEmail({
              to: data.email,
              subject: `Join ${data.organization.name} on otterdeploy`,
              react: OrganizationInvitationEmail({
                organizationName: data.organization.name,
                inviterName: data.inviter.user.name,
                inviteUrl,
                role: String(data.role ?? "member"),
              }),
            });
          } catch (error) {
            log.warn({
              invite: {
                status: "email-failed",
                email: data.email,
                // Logged so the operator can deliver the link out-of-band when
                // email isn't configured (e.g. placeholder RESEND_API_KEY in dev).
                inviteUrl,
                detail: error instanceof Error ? error.message : String(error),
              },
            });
          }
        },
        // RBAC: custom access-control statements + owner/admin/member roles
        // (packages/auth/src/permissions.ts). `auth.api.hasPermission` resolves
        // the active member's role against these — no manual member lookups.
        ac,
        roles,
        teams: {
          enabled: true,
          // Don't auto-create a "default project" on org create — our project
          // schema requires slug+environmentId, and projects are created
          // explicitly via the CreateProjectDialog flow (env first, then project).
          defaultTeam: { enabled: false },
        },
        schema: {
          team: {
            modelName: "project",
            additionalFields: {
              slug: { type: "string", required: true },
              environmentId: { type: "string", required: true },
            },
          },
        },
      }),
    ],
  });
}

export type AuthInstance = ReturnType<typeof buildAuth>;

/**
 * The live instance. Starts from the env-configured providers because module
 * evaluation is synchronous and the database may not be reachable yet; the
 * server calls `reloadAuth()` once during boot (and again after any social
 * sign-in setting is saved) to swap in the DB-resolved set.
 */
let currentAuth: AuthInstance = buildAuth(envSocialProviders);

/** Provider ids the live instance has registered. The sign-in page reads this
 *  through /api/auth/public-config so it renders exactly the buttons that
 *  actually work — it used to read the build-time VITE_AUTH_SOCIAL_PROVIDERS,
 *  which meant a self-hoster running the published image could never enable
 *  SSO without rebuilding the SPA. */
export function enabledSocialProviderIds(): string[] {
  return liveSocialProviderIds;
}

let liveSocialProviderIds: string[] = Object.keys(envSocialProviders);

/**
 * Rebuild the auth instance against the current social-provider settings.
 *
 * Swapping the whole instance (rather than mutating config in place) is the
 * only supported way to change `socialProviders` — better-auth reads them when
 * the instance is constructed. This is safe to do at runtime because every
 * durable piece of auth state lives outside the instance: sessions are rows
 * plus cookies signed with BETTER_AUTH_SECRET, which doesn't change here, so
 * signed-in users are unaffected. The one thing that does reset is the
 * in-memory rate-limit window — an acceptable cost on an admin-triggered,
 * infrequent action.
 *
 * Never throws: on failure the previous instance stays live and serving.
 */
export async function reloadAuth(): Promise<{ providers: string[] }> {
  try {
    const resolved = await resolveSocialProviders();
    const providers = toBetterAuthSocialProviders(resolved);
    currentAuth = buildAuth(providers);
    liveSocialProviderIds = resolved.map((p) => p.id);
    log.info({ auth: { event: "reloaded", socialProviders: liveSocialProviderIds } });
    return { providers: liveSocialProviderIds };
  } catch (error) {
    log.error({
      auth: { event: "reload-failed", keeping: liveSocialProviderIds },
      error: error instanceof Error ? error.message : String(error),
    });
    return { providers: liveSocialProviderIds };
  }
}

/**
 * Stable façade over the swappable instance. Every consumer imports `auth` as
 * a module-level const, so the reference they hold has to keep working across
 * a reload — hence a Proxy that forwards to whatever `currentAuth` is at call
 * time rather than a value they'd capture once.
 *
 * Methods are bound to the real instance so `this` never resolves to the proxy
 * (`auth.handler(req)` would otherwise pass the proxy as the receiver).
 * `getOwnPropertyDescriptor` has to report `configurable: true`: the proxy
 * target is a permanently-empty object, and reporting a non-configurable
 * property that doesn't exist on the target violates a Proxy invariant and
 * throws.
 */
export const auth: AuthInstance = new Proxy({} as AuthInstance, {
  get(_target, prop) {
    const value: unknown = Reflect.get(currentAuth as object, prop, currentAuth);
    if (typeof value !== "function") return value;
    return (value as (...args: unknown[]) => unknown).bind(currentAuth);
  },
  has: (_target, prop) => Reflect.has(currentAuth as object, prop),
  ownKeys: () => Reflect.ownKeys(currentAuth as object),
  getOwnPropertyDescriptor: (_target, prop) => {
    const descriptor = Reflect.getOwnPropertyDescriptor(currentAuth as object, prop);
    return descriptor ? { ...descriptor, configurable: true } : undefined;
  },
});

export type Session = AuthInstance["$Infer"]["Session"];
