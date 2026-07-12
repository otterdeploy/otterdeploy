import { defineCommand } from "citty";
import { consola } from "consola";

import { deviceCodeLogin, promptForUrl } from "../auth-flow";
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

    // webUrl = web origin from the device verification URL — init needs it
    // to write a working $schema URL, so persist it alongside the token.
    const { token, webUrl } = await deviceCodeLogin(url);
    saveConfig({ ...loadConfig(), url, webUrl, token });
    consola.success("Logged in.");
  },
});
