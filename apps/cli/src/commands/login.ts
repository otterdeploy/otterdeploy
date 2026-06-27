import { sleep } from "@otterdeploy/shared/promise";
import { defineCommand } from "citty";
import { consola } from "consola";

import { CLI_CLIENT_ID, createCliAuthClient } from "../auth-client";
import { promptForUrl } from "../auth-flow";
import { loadConfig, saveConfig } from "../config";

export const loginCommand = defineCommand({
  meta: {
    name: "login",
    description: "Authenticate with an otterdeploy control plane",
  },
  args: {
    // A `--url` flag, matching every other command. The bare positional form
    // (`otterdeploy login https://…`) still works via `args._` below.
    url: {
      type: "string",
      description: "Control plane URL (e.g. https://otter.acme.com)",
    },
  },
  async run({ args }) {
    // Resolution order: --url flag → bare positional → stored config → prompt.
    const positional = args._?.[0];
    const url = args.url ?? positional ?? loadConfig().url ?? (await promptForUrl());
    if (!url) {
      consola.error(
        "No URL provided. Run `otterdeploy login <url>` (e.g. https://otter.acme.com).",
      );
      process.exit(1);
    }

    const auth = createCliAuthClient(url);

    const codeRes = await auth.device.code({
      client_id: CLI_CLIENT_ID,
      scope: "openid profile",
    });
    if (codeRes.error || !codeRes.data) {
      consola.error(
        `Failed to request device code: ${codeRes.error?.error_description ?? "unknown error"}`,
      );
      process.exit(1);
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
        "Opening this URL in your browser:",
        "",
        `  ${fullUrl}`,
        "",
        "If it doesn't open, paste it manually. Confirm the code matches:",
        "",
        `  ${user_code}`,
      ].join("\n"),
    );
    openInBrowser(fullUrl);
    consola.info(`Waiting for approval… (code expires in ${expires_in ?? 1800}s)`);

    let pollSeconds = interval ?? 5;
    const deadline = Date.now() + (expires_in ?? 1800) * 1000;

    while (Date.now() < deadline) {
      await sleep(pollSeconds * 1000);

      const tokenRes = await auth.device.token({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code,
        client_id: CLI_CLIENT_ID,
      });

      if (tokenRes.data?.access_token) {
        saveConfig({
          ...loadConfig(),
          url,
          // The verification_uri is the web origin's /device URL —
          // grab its origin so init can write a working $schema URL.
          webUrl: safeOrigin(fullUrl),
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
          consola.error(
            `Login failed: ${errCode ?? tokenRes.error?.error_description ?? "unknown error"}`,
          );
          process.exit(1);
          return;
      }
    }

    consola.error("Timed out waiting for approval.");
    process.exit(1);
  },
});

function safeOrigin(maybeUrl: string): string | undefined {
  try {
    return new URL(maybeUrl).origin;
  } catch {
    return undefined;
  }
}

// Best-effort browser launch. Failure is non-fatal: the URL is also
// printed in the box above so the user can copy/paste.
function openInBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    // Ignore — user has the URL in the box.
  }
}
