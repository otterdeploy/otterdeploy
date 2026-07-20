/**
 * Device-code login. Driven explicitly by `otterdeploy login`, and implicitly
 * the first time any other command needs a token.
 *
 *   - Token already present (config file or OTTERDEPLOY_TOKEN env)? Use it.
 *   - Token missing? Walk the OAuth device-code flow against the URL,
 *     persist the result to ~/.config/otterdeploy/config.json, return it.
 *   - URL missing? Hard-fail with instructions.
 */

import { sleep } from "@otterdeploy/shared/promise";
import { consola } from "consola";

import { CLI_CLIENT_ID, createCliAuthClient, type CliAuthClient } from "./auth-client";
import {
  knownHosts,
  loadConfig,
  normalizeUrl,
  rememberHost,
  resolveToken,
  resolveUrl,
  saveConfig,
} from "./config";
import { openInBrowser } from "./lib/browser";

type DeviceCodeData = NonNullable<Awaited<ReturnType<CliAuthClient["device"]["code"]>>["data"]>;

/**
 * Ask the operator for the control plane URL on stdin when none was supplied
 * (no flag, no env, no stored config). Interactive only — in a non-TTY context
 * (CI, piped input) there's nobody to answer, so we return null and let the
 * caller print its actionable "set OTTERDEPLOY_URL / pass --url" error instead
 * of hanging on a prompt that never resolves.
 *
 * Bare hosts get an https:// scheme; the result is validated as a URL and the
 * trailing slash is stripped so it composes cleanly with `${url}/api/auth`.
 */
export async function promptForUrl(): Promise<string | null> {
  if (!process.stdin.isTTY) return null;

  // Offer the control planes this machine has signed into before, so the
  // common case is an arrow-key pick rather than retyping a domain from
  // memory. First run (no history) goes straight to the text prompt.
  //
  // The currently-configured `url` is folded in so a CLI upgrading from a
  // version that predates the history list still shows the domain already in
  // use, instead of an empty pick-list on the first run after upgrade.
  const stored = normalizeUrl(loadConfig().url);
  const remembered = knownHosts();
  const known =
    stored && !remembered.includes(stored) ? [stored, ...remembered] : remembered;
  if (known.length > 0) {
    const ENTER_NEW = "__enter_new__";
    const picked = await consola.prompt("Which control plane?", {
      type: "select",
      options: [
        ...known.map((host) => ({ label: host, value: host })),
        { label: "Enter a different domain…", value: ENTER_NEW },
      ],
    });
    if (typeof picked !== "string") return null; // cancelled (Ctrl-C)
    if (picked !== ENTER_NEW) return picked; // already normalized when stored
  }

  return promptForNewUrl();
}

/** Free-text control plane prompt — the first-run path, and the escape hatch
 *  from the pick-list above. */
async function promptForNewUrl(): Promise<string | null> {
  const raw = await consola.prompt("Control plane URL (e.g. https://otter.acme.com):", {
    type: "text",
  });
  if (typeof raw !== "string") return null; // cancelled (Ctrl-C)
  const url = normalizeUrl(raw);
  if (!url) {
    if (raw.trim()) consola.error(`"${raw.trim()}" is not a valid URL.`);
    return null;
  }
  return url;
}

export interface AuthedSession {
  url: string;
  token: string;
}

export async function ensureAuthenticated(urlOverride?: string): Promise<AuthedSession> {
  const url = resolveUrl(urlOverride) ?? (await promptForUrl());
  if (!url) {
    consola.error(
      "No control plane URL configured. Set OTTERDEPLOY_URL or pass --url <https://…>.",
    );
    process.exit(1);
  }

  const existing = resolveToken();
  if (existing) return { url, token: existing };

  consola.info(`Not authenticated — starting browser-based login at ${url}.`);
  const { token, webUrl } = await deviceCodeLogin(url);
  saveConfig({ ...loadConfig(), url, webUrl, token });
  rememberHost(url);
  consola.success("Logged in.");
  return { url, token };
}

export interface DeviceLoginResult {
  token: string;
  webUrl?: string;
}

export async function deviceCodeLogin(url: string): Promise<DeviceLoginResult> {
  const auth = createCliAuthClient(url);
  const code = await requestDeviceCode(auth);
  const fullUrl =
    code.verification_uri_complete ??
    `${url.replace(/\/$/, "")}${code.verification_uri}?user_code=${code.user_code}`;

  consola.box(
    [
      "Opening this URL in your browser:",
      "",
      `  ${fullUrl}`,
      "",
      "If it doesn't open, paste it manually. Confirm the code matches:",
      "",
      `  ${code.user_code}`,
    ].join("\n"),
  );
  openInBrowser(fullUrl);
  consola.info(`Waiting for approval… (code expires in ${code.expires_in ?? 1800}s)`);

  const token = await pollForDeviceToken(auth, code);
  // verification_uri carries the web origin (in dev that's a different host
  // than the API). Capture it so init can build a proper $schema URL without
  // a separate config endpoint.
  return { token, webUrl: safeOrigin(fullUrl) };
}

// Request a device code, throwing on failure.
async function requestDeviceCode(auth: CliAuthClient): Promise<DeviceCodeData> {
  const codeRes = await auth.device.code({
    client_id: CLI_CLIENT_ID,
    scope: "openid profile",
  });
  if (codeRes.error || !codeRes.data) {
    throw new Error(
      `Failed to request device code: ${codeRes.error?.error_description ?? "unknown error"}`,
    );
  }
  return codeRes.data;
}

// Poll the token endpoint until approval, backing off on `slow_down`.
// Returns the access token or throws a terminal error.
async function pollForDeviceToken(auth: CliAuthClient, code: DeviceCodeData): Promise<string> {
  let pollSeconds = code.interval ?? 5;
  const deadline = Date.now() + (code.expires_in ?? 1800) * 1000;

  while (Date.now() < deadline) {
    await sleep(pollSeconds * 1000);
    const tokenRes = await auth.device.token({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: code.device_code,
      client_id: CLI_CLIENT_ID,
    });
    if (tokenRes.data?.access_token) return tokenRes.data.access_token;

    const errCode = tokenRes.error?.error;
    if (errCode === "authorization_pending") continue;
    if (errCode === "slow_down") {
      pollSeconds += 5;
      continue;
    }
    if (errCode === "access_denied") throw new Error("Access denied.");
    if (errCode === "expired_token") throw new Error("Device code expired.");
    throw new Error(`Login failed: ${errCode ?? tokenRes.error?.error_description ?? "unknown"}`);
  }
  throw new Error("Timed out waiting for approval.");
}

// Best-effort origin extraction; undefined when the string isn't a valid URL.
function safeOrigin(maybeUrl: string): string | undefined {
  try {
    return new URL(maybeUrl).origin;
  } catch {
    return undefined;
  }
}

// Re-exported for callers that already import it from here.
export { openInBrowser };
