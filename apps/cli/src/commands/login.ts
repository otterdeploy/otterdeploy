import { defineCommand } from "citty";
import { consola } from "consola";

import { CLI_CLIENT_ID, createCliAuthClient } from "../auth-client";
import { loadConfig, saveConfig } from "../config";

export const loginCommand = defineCommand({
  meta: {
    name: "login",
    description: "Authenticate with an otterdeploy control plane",
  },
  args: {
    url: {
      type: "positional",
      required: false,
      description: "Control plane URL (e.g. https://otter.acme.com)",
    },
  },
  async run({ args }) {
    const url = args.url ?? loadConfig().url;
    if (!url) {
      consola.error(
        "No URL provided. Run `otterdeploy login <url>` (e.g. https://otter.acme.com).",
      );
      process.exit(1);
    }

    const auth = createCliAuthClient(url);

    // 1. Ask the server for a device + user code.
    const codeRes = await auth.device.code({
      client_id: CLI_CLIENT_ID,
      scope: "openid profile",
    });
    if (codeRes.error || !codeRes.data) {
      consola.error(`Failed to request device code: ${codeRes.error?.error_description ?? "unknown error"}`);
      process.exit(1);
    }

    const { device_code, user_code, verification_uri, verification_uri_complete, interval, expires_in } =
      codeRes.data;
    const fullUrl = verification_uri_complete ?? `${url.replace(/\/$/, "")}${verification_uri}?user_code=${user_code}`;

    consola.box(
      [
        "First, open this URL in your browser:",
        "",
        `  ${fullUrl}`,
        "",
        "Then confirm this code matches:",
        "",
        `  ${user_code}`,
      ].join("\n"),
    );
    consola.info(`Waiting for approval… (code expires in ${expires_in ?? 1800}s)`);

    // 2. Poll /device/token until approved, denied, or expired.
    let pollSeconds = interval ?? 5;
    const deadline = Date.now() + (expires_in ?? 1800) * 1000;

    while (Date.now() < deadline) {
      await sleep(pollSeconds * 1000);

      const tokenRes = await auth.device.token({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code,
        client_id: CLI_CLIENT_ID,
      });

      // Success — got a token.
      if (tokenRes.data?.access_token) {
        saveConfig({
          ...loadConfig(),
          url,
          token: tokenRes.data.access_token,
        });
        consola.success("Logged in.");
        return;
      }

      const errCode = tokenRes.error?.error;
      switch (errCode) {
        case "authorization_pending":
          continue;
        case "slow_down":
          pollSeconds += 5;
          continue;
        case "access_denied":
          consola.error("Access denied.");
          process.exit(1);
          return;
        case "expired_token":
          consola.error("Device code expired. Run `otterdeploy login <url>` again.");
          process.exit(1);
          return;
        default:
          consola.error(`Login failed: ${errCode ?? tokenRes.error?.error_description ?? "unknown error"}`);
          process.exit(1);
          return;
      }
    }

    consola.error("Timed out waiting for approval.");
    process.exit(1);
  },
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
