import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import * as z from "zod";

// One control plane per user. URL is set by `otterdeploy login <url>`,
// token by the device-code exchange, orgId by `otterdeploy org use`.
const ConfigSchema = z.object({
  url: z.string().url().optional(),
  token: z.string().optional(),
  orgId: z.string().optional(),
});
export type Config = z.infer<typeof ConfigSchema>;

const CONFIG_DIR = process.env.OTTERDEPLOY_CONFIG_DIR
  ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "otterdeploy");
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
  return flag ?? process.env.OTTERDEPLOY_URL ?? loadConfig().url;
}

// CI auth: OTTERDEPLOY_TOKEN bypasses the device-code flow entirely.
export function resolveToken(): string | undefined {
  return process.env.OTTERDEPLOY_TOKEN ?? loadConfig().token;
}

export const CONFIG_PATH_FOR_DISPLAY = CONFIG_PATH;
