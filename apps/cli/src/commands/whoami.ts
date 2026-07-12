import { defineCommand } from "citty";
import { consola } from "consola";

import { createCliAuthClient } from "../auth-client";
import { createCliClient } from "../client";
import { resolveToken, resolveUrl } from "../config";

export const whoamiCommand = defineCommand({
  meta: {
    name: "whoami",
    description: "Show the currently logged-in user",
  },
  args: {
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const url = resolveUrl(args.url);
    const token = resolveToken();
    if (!url || !token) {
      consola.error("Not logged in. Run `otterdeploy login <url>`.");
      process.exit(1);
    }

    // otter_-prefixed tokens are API keys: org-scoped actors with no user
    // session, so getSession can't identify them. A cheap org-scoped read
    // proves the key works; an invalid key throws and the boundary formats it.
    if (token.startsWith("otter_")) {
      const client = createCliClient({ url, token });
      await client.project.list();
      if (args.json) {
        process.stdout.write(
          `${JSON.stringify({ method: "api-key", user: null, url, org: null }, null, 2)}\n`,
        );
        return;
      }
      consola.success("Authenticated with an API key (org-scoped).");
      consola.info(`URL:     ${url}`);
      return;
    }

    const auth = createCliAuthClient(url);
    const headers = { Authorization: `Bearer ${token}` };
    const session = await auth.getSession({ fetchOptions: { headers } });

    if (!session.data) {
      consola.error("Session expired or invalid. Run `otterdeploy login <url>` again.");
      process.exit(1);
    }

    const { user } = session.data;
    // The active org lives on the SESSION row (set by `org use`), not in the
    // local config file — resolve it server-side so the answer is never stale.
    const activeOrgId = session.data.session.activeOrganizationId;
    const orgs = activeOrgId ? await auth.organization.list({ fetchOptions: { headers } }) : null;
    const activeOrg = orgs?.data?.find((o) => o.id === activeOrgId) ?? null;

    if (args.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            method: "session",
            user: { name: user.name, email: user.email },
            url,
            org: activeOrg
              ? { id: activeOrg.id, slug: activeOrg.slug, name: activeOrg.name }
              : null,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    consola.info(
      [
        `User:    ${user.name} <${user.email}>`,
        `URL:     ${url}`,
        activeOrg ? `Org:     ${activeOrg.slug} (${activeOrg.name})` : "Org:     (none)",
      ].join("\n"),
    );
    if (!activeOrg) {
      consola.info("No active organization. Run `otterdeploy org use <slug>` to pick one.");
    }
  },
});
