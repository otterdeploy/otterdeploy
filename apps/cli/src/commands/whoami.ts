import { defineCommand } from "citty";

import { createCliAuthClient } from "../auth-client";
import { createCliClient } from "../client";
import { resolveToken, resolveUrl } from "../config";
import { cmd } from "../lib/name";
import { abort, detail, dim, hint, ok, paint, section } from "../lib/ui";

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
      abort("Not logged in.", `run \`${cmd("login <url>")}\``);
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
      ok("Authenticated with an API key.");
      section("Session");
      detail([
        ["method", `api key ${dim("(org-scoped)")}`],
        ["url", url],
      ]);
      return;
    }

    const auth = createCliAuthClient(url);
    const headers = { Authorization: `Bearer ${token}` };
    const session = await auth.getSession({ fetchOptions: { headers } });

    if (!session.data) {
      abort("Session expired or invalid.", `run \`${cmd("login <url>")}\` again`);
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

    section("Session");
    detail([
      ["user", `${user.name} ${dim(`<${user.email}>`)}`],
      ["url", url],
      // An absent org is a real state that blocks most commands, so it reads as
      // a warning rather than an empty value.
      [
        "org",
        activeOrg ? `${activeOrg.slug} ${dim(`(${activeOrg.name})`)}` : paint("warn", "none"),
      ],
    ]);
    if (!activeOrg) hint(`run \`${cmd("org use <slug>")}\` to pick one`);
  },
});
