import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as z from "zod";

// One control plane per user. URL is set by `otterdeploy login <url>`,
// token by the device-code exchange, orgId by `otterdeploy org use`.
const ConfigSchema = z.object({
  url: z.url().optional(),
  // Origin of the web app — used for `$schema` URLs in generated config
  // files. Captured from the device-code response's verification_uri
  // during login (no separate user input). In single-domain prod
  // deployments this matches `url`; in dev it diverges.
  webUrl: z.url().optional(),
  token: z.string().optional(),
  orgId: z.string().optional(),
  // Slug of the active org — set by `org use`, read by `open` to build
  // dashboard URLs without an extra round-trip.
  orgSlug: z.string().optional(),
  // Control planes this machine has logged into before, most-recent first.
  // Login offers these as a pick-list instead of asking the operator to
  // retype a domain from memory. Survives `logout` — the whole point is to
  // still know your domains after signing out. Never contains credentials.
  hosts: z.array(z.url()).optional(),
});
export type Config = z.infer<typeof ConfigSchema>;

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

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return ConfigSchema.parse(raw);
  } catch {
    return {};
  }
}

export function saveConfig(config: Config): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  // 0600 — token lives here, treat it like an SSH key.
  chmodSync(CONFIG_PATH, 0o600);
}

export function clearConfig(): void {
  if (existsSync(CONFIG_PATH)) {
    // Keep the known-host list: signing out shouldn't make the operator
    // retype a domain they've used before. Everything else (token, url,
    // org selection) goes.
    const { hosts } = loadConfig();
    writeFileSync(CONFIG_PATH, JSON.stringify(hosts?.length ? { hosts } : {}, null, 2));
    chmodSync(CONFIG_PATH, 0o600);
  }
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
 * Every URL source funnels through here — `--url` flag, positional arg,
 * OTTERDEPLOY_URL env, stored config, interactive prompt — so a scheme-less
 * host is accepted everywhere, not just at the prompt. Without this,
 * `login --url deploy.acme.com` reached better-auth as
 * `deploy.acme.com/api/auth` and died with "Invalid base URL".
 */
export function normalizeUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let url = raw.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  if (!z.url().safeParse(url).success) return null;
  return url.replace(/\/$/, "");
}

// Resolution order: --url flag > OTTERDEPLOY_URL env > stored config.
// Normalized so a scheme-less host resolves the same from any source.
export function resolveUrl(flag?: string): string | undefined {
  return normalizeUrl(flag ?? env.OTTERDEPLOY_URL ?? loadConfig().url) ?? undefined;
}

// CI auth: OTTERDEPLOY_TOKEN bypasses the device-code flow entirely.
export function resolveToken(): string | undefined {
  return env.OTTERDEPLOY_TOKEN ?? loadConfig().token;
}

// Where the active token came from — the error boundary only clears and
// re-auths config-file tokens; env tokens belong to the caller (CI).
export function tokenSource(): "env" | "config" | null {
  if (env.OTTERDEPLOY_TOKEN) return "env";
  if (loadConfig().token) return "config";
  return null;
}

// Drop only the token — URL, webUrl, and org selection survive re-login.
export function clearToken(): void {
  const { token: _token, ...rest } = loadConfig();
  saveConfig(rest);
}
