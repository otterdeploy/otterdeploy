import { defineCommand } from "citty";
import { consola } from "consola";

import { createCliAuthClient } from "../auth-client";
import { loadConfig, resolveToken, resolveUrl } from "../config";

export const whoamiCommand = defineCommand({
  meta: {
    name: "whoami",
    description: "Show the currently logged-in user",
  },
  args: {
    url: { type: "string", description: "Override control plane URL" },
  },
  async run({ args }) {
    const url = resolveUrl(args.url);
    const token = resolveToken();
    if (!url || !token) {
      consola.error("Not logged in. Run `otterdeploy login <url>`.");
      process.exit(1);
    }

    const auth = createCliAuthClient(url);
    const session = await auth.getSession({
      fetchOptions: { headers: { Authorization: `Bearer ${token}` } },
    });

    if (!session.data) {
      consola.error("Session expired or invalid. Run `otterdeploy login <url>` again.");
      process.exit(1);
    }

    const { user } = session.data;
    const stored = loadConfig();
    consola.info(
      [
        `User:    ${user.name} <${user.email}>`,
        `URL:     ${url}`,
        stored.orgId ? `Org:     ${stored.orgId}` : "Org:     (none selected)",
      ].join("\n"),
    );
  },
});
