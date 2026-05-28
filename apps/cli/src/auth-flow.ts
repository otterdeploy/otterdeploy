/**
 * Implicit device-code login. Runs automatically the first time a
 * command needs a token — there's no separate `login` verb on this CLI.
 *
 *   - Token already present (config file or OTTERDEPLOY_TOKEN env)? Use it.
 *   - Token missing? Walk the OAuth device-code flow against the URL,
 *     persist the result to ~/.config/otterdeploy/config.json, return it.
 *   - URL missing? Hard-fail with instructions.
 */

import { consola } from "consola";

import { CLI_CLIENT_ID, createCliAuthClient } from "./auth-client";
import { loadConfig, resolveToken, resolveUrl, saveConfig } from "./config";

export interface AuthedSession {
  url: string;
  token: string;
}

export async function ensureAuthenticated(urlOverride?: string): Promise<AuthedSession> {
  const url = resolveUrl(urlOverride);
  if (!url) {
    consola.error(
      "No control plane URL configured. Set OTTERDEPLOY_URL or pass --url <https://…>.",
    );
    process.exit(1);
  }

  const existing = resolveToken();
  if (existing) return { url, token: existing };

  consola.info(`Not authenticated — starting browser-based login at ${url}.`);
  const token = await deviceCodeLogin(url);
  saveConfig({ ...loadConfig(), url, token });
  consola.success("Logged in.");
  return { url, token };
}

async function deviceCodeLogin(url: string): Promise<string> {
  const auth = createCliAuthClient(url);

  const codeRes = await auth.device.code({
    client_id: CLI_CLIENT_ID,
    scope: "openid profile",
  });
  if (codeRes.error || !codeRes.data) {
    throw new Error(
      `Failed to request device code: ${codeRes.error?.error_description ?? "unknown error"}`,
    );
  }
  const {
    device_code,
    user_code,
    verification_uri,
    verification_uri_complete,
    interval,
    expires_in,
  } = codeRes.data;
  const fullUrl =
    verification_uri_complete ??
    `${url.replace(/\/$/, "")}${verification_uri}?user_code=${user_code}`;

  consola.box(
    [
      "Open this URL in your browser:",
      "",
      `  ${fullUrl}`,
      "",
      "and confirm the code matches:",
      "",
      `  ${user_code}`,
    ].join("\n"),
  );

  let pollSeconds = interval ?? 5;
  const deadline = Date.now() + (expires_in ?? 1800) * 1000;

  while (Date.now() < deadline) {
    await sleep(pollSeconds * 1000);
    const tokenRes = await auth.device.token({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code,
      client_id: CLI_CLIENT_ID,
    });
    if (tokenRes.data?.access_token) return tokenRes.data.access_token;

    const code = tokenRes.error?.error;
    if (code === "authorization_pending") continue;
    if (code === "slow_down") {
      pollSeconds += 5;
      continue;
    }
    if (code === "access_denied") throw new Error("Access denied.");
    if (code === "expired_token") throw new Error("Device code expired.");
    throw new Error(`Login failed: ${code ?? tokenRes.error?.error_description ?? "unknown"}`);
  }
  throw new Error("Timed out waiting for approval.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
