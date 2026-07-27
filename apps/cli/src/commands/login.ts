import { defineCommand } from "citty";

import { deviceCodeLogin, promptForUrl } from "../auth-flow";
import { loadConfig, normalizeUrl, rememberHost, saveConfig } from "../config";
import { cmd } from "../lib/name";
import { abort, ok } from "../lib/ui";

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
    // Explicit inputs are normalized (bare host → https://) and validated up
    // front, so `login --url deploy.acme.com` works and a typo fails with a
    // clear message instead of a downstream "Invalid base URL".
    // Interactively, a stored `url` is NOT treated as explicit: bare
    // `otterdeploy login` should offer the domains you already have (the
    // stored one among them) rather than silently reusing the last one —
    // that pick-list is the point. Non-interactively there's nobody to ask,
    // so the stored URL still wins and CI behaviour is unchanged.
    const positional = args._?.[0];
    const explicit = args.url ?? positional ?? (process.stdin.isTTY ? undefined : loadConfig().url);
    let url: string | null;
    if (explicit) {
      url = normalizeUrl(explicit);
      if (!url) {
        abort(
          `"${explicit}" is not a valid control plane URL.`,
          "include the scheme, e.g. https://",
        );
      }
    } else {
      url = await promptForUrl();
    }
    if (!url) {
      abort(
        "No control plane URL given.",
        `run \`${cmd("login <url>")}\`, e.g. https://otter.acme.com`,
      );
    }

    // webUrl = web origin from the device verification URL — init needs it
    // to write a working $schema URL, so persist it alongside the token.
    const { token, webUrl } = await deviceCodeLogin(url);
    saveConfig({ ...loadConfig(), url, webUrl, token });
    rememberHost(url);
    ok("Logged in.");
  },
});
