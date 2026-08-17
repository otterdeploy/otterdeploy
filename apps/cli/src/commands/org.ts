import { defineCommand } from "citty";

import { createCliAuthClient } from "../auth-client";
import { ensureAuthenticated } from "../auth-flow";
import { loadConfig, saveConfig } from "../config";
import { cmd } from "../lib/name";
import { suggestions } from "../lib/suggest";
import { abort, dim, hint, note, ok, section, stateGlyph, table } from "../lib/ui";

const listOrgs = defineCommand({
  meta: { name: "list", description: "List organizations you belong to" },
  args: {
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const { url, token } = await ensureAuthenticated(args.url);
    const auth = createCliAuthClient(url);
    const fetchOptions = { headers: { Authorization: `Bearer ${token}` } };

    const orgs = await auth.organization.list({ fetchOptions });
    if (orgs.error || !orgs.data) {
      abort(orgs.error?.message ?? "Failed to list organizations.");
    }
    const session = await auth.getSession({ fetchOptions });
    const activeId = session.data?.session.activeOrganizationId ?? null;

    if (args.json) {
      const rows = orgs.data.map((org) => ({ ...org, isActive: org.id === activeId }));
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      return;
    }

    if (orgs.data.length === 0) {
      note("You don't belong to any organizations yet.");
      return;
    }

    section("Organizations");
    table(
      [{ header: "" }, { header: "slug" }, { header: "name" }],
      orgs.data.map((org) => [
        // The active org gets the live glyph rather than an asterisk, so it
        // reads in the same vocabulary as every other state in the CLI.
        org.id === activeId ? stateGlyph("running") : " ",
        org.slug,
        dim(org.name),
      ]),
    );
    if (!activeId) hint(`run \`${cmd("org use <slug>")}\` to pick one`);
  },
});

const useOrg = defineCommand({
  meta: { name: "use", description: "Set the active organization" },
  args: {
    slug: { type: "positional", required: true, description: "Organization slug" },
    url: { type: "string", description: "Override control plane URL" },
  },
  async run({ args }) {
    const { url, token } = await ensureAuthenticated(args.url);
    const auth = createCliAuthClient(url);
    const { data, error } = await auth.organization.setActive({
      organizationSlug: args.slug,
      fetchOptions: { headers: { Authorization: `Bearer ${token}` } },
    });
    if (error || !data) {
      // A bad slug is the common case here, so offer the near matches rather
      // than only relaying the server's message.
      const orgs = await auth.organization.list({
        fetchOptions: { headers: { Authorization: `Bearer ${token}` } },
      });
      const near = suggestions(
        args.slug,
        (orgs.data ?? []).map((o) => o.slug),
      );
      abort(
        error?.message ?? `Could not switch to organization ${args.slug}.`,
        ...near.map((s) => `did you mean \`${s}\`?`),
        `run \`${cmd("org list")}\` to see them`,
      );
    }
    // setActive rewrites activeOrganizationId on the existing session row:
    // the stored token stays valid, only the local selection is recorded.
    saveConfig({ ...loadConfig(), orgId: data.id, orgSlug: data.slug });
    ok(`Active organization is now ${data.slug} ${dim(`(${data.name})`)}.`);
  },
});

export const orgCommand = defineCommand({
  meta: { name: "org", description: "Manage organizations" },
  subCommands: {
    list: listOrgs,
    use: useOrg,
  },
});
