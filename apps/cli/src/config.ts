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
    writeFileSync(CONFIG_PATH, "{}");
    chmodSync(CONFIG_PATH, 0o600);
  }
}

// Resolution order: --url flag > OTTERDEPLOY_URL env > stored config.
export function resolveUrl(flag?: string): string | undefined {
  return flag ?? env.OTTERDEPLOY_URL ?? loadConfig().url;
}

// CI auth: OTTERDEPLOY_TOKEN bypasses the device-code flow entirely.
export function resolveToken(): string | undefined {
  return env.OTTERDEPLOY_TOKEN ?? loadConfig().token;
}
