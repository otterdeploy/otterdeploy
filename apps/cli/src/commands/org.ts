import { defineCommand } from "citty";
import { consola } from "consola";

import { createCliAuthClient } from "../auth-client";
import { ensureAuthenticated } from "../auth-flow";
import { loadConfig, saveConfig } from "../config";

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
      consola.error(orgs.error?.message ?? "Failed to list organizations.");
      process.exit(1);
    }
    const session = await auth.getSession({ fetchOptions });
    const activeId = session.data?.session.activeOrganizationId ?? null;

    if (args.json) {
      const rows = orgs.data.map((org) => ({ ...org, isActive: org.id === activeId }));
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      return;
    }

    if (orgs.data.length === 0) {
      consola.info("You don't belong to any organizations yet.");
      return;
    }
    const width = Math.max(...orgs.data.map((org) => org.slug.length));
    for (const org of orgs.data) {
      const marker = org.id === activeId ? "*" : " ";
      consola.log(`${marker} ${org.slug.padEnd(width)}  ${org.name}`);
    }
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
      consola.error(error?.message ?? `Could not switch to organization ${args.slug}.`);
      process.exit(1);
    }
    // setActive rewrites activeOrganizationId on the existing session row —
    // the stored token stays valid, only the local selection is recorded.
    saveConfig({ ...loadConfig(), orgId: data.id, orgSlug: data.slug });
    consola.success(`Active organization: ${data.name} (${data.slug}).`);
  },
});

export const orgCommand = defineCommand({
  meta: { name: "org", description: "Manage organizations" },
  subCommands: {
    list: listOrgs,
    use: useOrg,
  },
});
