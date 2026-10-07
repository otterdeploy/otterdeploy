/**
 * One context per control plane.
 *
 * The CLI used to hold a single `{ url, token, orgId, orgSlug }`, on the
 * assumption of one control plane per user. `--url` was honoured everywhere
 * anyway, and the token was resolved on a SEPARATE ladder that never looked at
 * which host had been selected — so `otd … --url https://other` presented the
 * first host's bearer token to the second one, and the stored `orgSlug` still
 * named an org that only existed on the first. Neither is a state the operator
 * could see, let alone correct.
 *
 * The fix is the shape `gh` and Linear's CLI both settled on: the credential is
 * a PROPERTY of the target, not a sibling of it. A context is keyed by its
 * normalized URL and owns the token, the web origin and the org selection for
 * that host. Selecting a host selects all four together, so the mismatched pair
 * is no longer representable.
 *
 * The legacy flat shape is still READ, and folded into a context on load, so an
 * existing config keeps working across the upgrade. It is never written back.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as z from "zod";

/** What the CLI knows about one control plane. */
const ContextSchema = z.object({
  token: z.string().optional(),
  /**
   * Origin of the web app, used for `$schema` URLs in generated config files.
   * Captured from the device-code response's verification_uri during login (no
   * separate user input). In single-domain prod deployments this matches the
   * context's own URL; in dev it diverges.
   */
  webUrl: z.url().optional(),
  orgId: z.string().optional(),
  /**
   * Slug of the active org ON THIS HOST: set by `org use`, read by `open` to
   * build dashboard URLs without an extra round-trip. Scoped to the context
   * because an org id means nothing on a different control plane.
   */
  orgSlug: z.string().optional(),
});
export type Context = z.infer<typeof ContextSchema>;

/** A context plus the host it belongs to — what every command actually needs. */
export interface ResolvedContext extends Context {
  url?: string;
}

const ConfigSchema = z.object({
  /** Keyed by normalized control plane URL. */
  contexts: z.record(z.string(), ContextSchema).optional(),
  /** The host commands target when nothing overrides it. */
  current: z.url().optional(),
  /**
   * Control planes this machine has logged into before, most-recent first.
   * Login offers these as a pick-list instead of asking the operator to retype
   * a domain from memory. Survives `logout`: the whole point is to still know
   * your domains after signing out. Never contains credentials.
   */
  hosts: z.array(z.url()).optional(),

  // The pre-context shape. Read on load and migrated; never written back.
  url: z.url().optional(),
  webUrl: z.url().optional(),
  token: z.string().optional(),
  orgId: z.string().optional(),
  orgSlug: z.string().optional(),
});
type StoredConfig = z.infer<typeof ConfigSchema>;

/** The config as the rest of the CLI sees it: contexts only. */
export interface Config {
  contexts: Record<string, Context>;
  current?: string;
  hosts?: string[];
}

// The `otterdeploy` binary is a standalone end-user CLI: its env vars
// (OTTERDEPLOY_*, XDG_CONFIG_HOME) aren't part of the server/web runtime
// schema, so it reads them here rather than depending on @otterdeploy/env.
// This module is the CLI's env boundary.
// oxlint-disable-next-line node/no-process-env -- standalone CLI env boundary (see comment above)
const env = process.env;

const CONFIG_DIR =
  env.OTTERDEPLOY_CONFIG_DIR ??
  join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "otterdeploy");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

/**
 * Fold a pre-context config into the new shape.
 *
 * Everything the old file knew belonged to its single `url`, so that is the
 * context it becomes, and the one that stays current. A file with no `url` has
 * nothing to attribute, so its stray token is dropped rather than guessed at.
 */
function migrate(stored: StoredConfig): Config {
  const contexts: Record<string, Context> = { ...stored.contexts };
  const legacyUrl = normalizeUrl(stored.url);
  if (legacyUrl && !contexts[legacyUrl]) {
    const legacy: Context = {
      ...(stored.token ? { token: stored.token } : {}),
      ...(stored.webUrl ? { webUrl: stored.webUrl } : {}),
      ...(stored.orgId ? { orgId: stored.orgId } : {}),
      ...(stored.orgSlug ? { orgSlug: stored.orgSlug } : {}),
    };
    contexts[legacyUrl] = legacy;
  }
  return {
    contexts,
    ...((stored.current ?? legacyUrl) ? { current: stored.current ?? legacyUrl ?? undefined } : {}),
    ...(stored.hosts ? { hosts: stored.hosts } : {}),
  };
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) return { contexts: {} };
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return migrate(ConfigSchema.parse(raw));
  } catch {
    return { contexts: {} };
  }
}

export function saveConfig(config: Config): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  // 0600: tokens live here, treat it like an SSH key.
  chmodSync(CONFIG_PATH, 0o600);
}

/** Merge a patch into one host's context, creating it if new. */
export function saveContext(url: string, patch: Context): void {
  const config = loadConfig();
  saveConfig({
    ...config,
    contexts: { ...config.contexts, [url]: { ...config.contexts[url], ...patch } },
  });
}

/** Make `url` the host commands target by default. */
export function setCurrent(url: string): void {
  saveConfig({ ...loadConfig(), current: url });
}

/** Every control plane with a stored context, current one first. */
export function listContexts(): { url: string; context: Context; isCurrent: boolean }[] {
  const { contexts, current } = loadConfig();
  return Object.entries(contexts)
    .map(([url, context]) => ({ url, context, isCurrent: url === current }))
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.url.localeCompare(b.url));
}

/**
 * Sign out of one host, or all of them.
 *
 * The known-host list survives either way: signing out shouldn't make the
 * operator retype a domain they've used before.
 */
export function clearConfig(url?: string): void {
  const config = loadConfig();
  if (!url) {
    saveConfig({ contexts: {}, ...(config.hosts?.length ? { hosts: config.hosts } : {}) });
    return;
  }
  const { [url]: _gone, ...rest } = config.contexts;
  saveConfig({
    contexts: rest,
    // Leaving `current` pointed at a signed-out host would make every later
    // command re-prompt for a login it could instead just ask for by name.
    ...(config.current && config.current !== url ? { current: config.current } : {}),
    ...(config.hosts?.length ? { hosts: config.hosts } : {}),
  });
}

/** Control planes this machine has logged into, most-recent first. */
export function knownHosts(): string[] {
  return loadConfig().hosts ?? [];
}

/**
 * Record a successful login's control plane, most-recent first, de-duplicated.
 * Capped so a machine that talks to many short-lived environments doesn't grow
 * an unbounded pick-list.
 */
const MAX_REMEMBERED_HOSTS = 10;
export function rememberHost(url: string): void {
  const config = loadConfig();
  const next = [url, ...(config.hosts ?? []).filter((h) => h !== url)].slice(
    0,
    MAX_REMEMBERED_HOSTS,
  );
  saveConfig({ ...config, hosts: next });
}

/**
 * Normalize a user-supplied control plane URL: bare hosts
 * (`deploy.acme.com`) get an `https://` scheme, the result is validated as a
 * URL, and any trailing slash is stripped so it composes cleanly with
 * `${url}/api/auth`. Returns null for empty/invalid input.
 *
 * Every URL source funnels through here: `--url` flag, positional arg,
 * OTTERDEPLOY_URL env, stored config, interactive prompt, so a scheme-less
 * host is accepted everywhere, not just at the prompt. Without this,
 * `login --url deploy.acme.com` reached better-auth as
 * `deploy.acme.com/api/auth` and died with "Invalid base URL".
 *
 * It is also what makes a context key canonical: `acme.com` and
 * `https://acme.com/` must not become two contexts for one host.
 */
export function normalizeUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let url = raw.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  if (!z.url().safeParse(url).success) return null;
  return url.replace(/\/$/, "");
}

// Resolution order: --url flag > OTTERDEPLOY_URL env > current context.
// Normalized so a scheme-less host resolves the same from any source.
export function resolveUrl(flag?: string): string | undefined {
  return normalizeUrl(flag ?? env.OTTERDEPLOY_URL ?? loadConfig().current) ?? undefined;
}

/**
 * The host and its credential, resolved TOGETHER.
 *
 * This is the whole point of the module: one call picks the control plane and
 * the token, org and web origin that belong to it, so a command cannot end up
 * holding one host's URL and another's token.
 *
 * `OTTERDEPLOY_TOKEN` still wins for CI, where the token is injected rather
 * than stored. It applies to whichever host resolved — that pairing is the
 * caller's to get right, and `OTTERDEPLOY_URL` is how they say so.
 */
export function resolveContext(flag?: string): ResolvedContext {
  const url = resolveUrl(flag);
  const stored = url ? loadConfig().contexts[url] : undefined;
  const envToken = env.OTTERDEPLOY_TOKEN;
  return {
    ...stored,
    ...(url ? { url } : {}),
    ...(envToken ? { token: envToken } : {}),
  };
}

// CI auth: OTTERDEPLOY_TOKEN bypasses the device-code flow entirely. Pass the
// same `--url` the command is using, or the token is looked up for the wrong
// host — which is the bug this module exists to make unrepresentable.
export function resolveToken(flag?: string): string | undefined {
  return resolveContext(flag).token;
}

// Where the active token came from. The error boundary only clears and
// re-auths config-file tokens; env tokens belong to the caller (CI).
export function tokenSource(flag?: string): "env" | "config" | null {
  if (env.OTTERDEPLOY_TOKEN) return "env";
  return resolveContext(flag).token ? "config" : null;
}

/**
 * Drop one host's token. The URL, web origin and org selection survive, so a
 * re-login lands the operator back where they were.
 */
export function clearToken(flag?: string): void {
  const url = resolveUrl(flag);
  if (!url) return;
  const config = loadConfig();
  const context = config.contexts[url];
  if (!context) return;
  const { token: _token, ...rest } = context;
  saveConfig({ ...config, contexts: { ...config.contexts, [url]: rest } });
}
