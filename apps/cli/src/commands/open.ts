import { defineCommand } from "citty";

import { createCliAuthClient } from "../auth-client";
import { loadConfig, resolveToken, saveConfig } from "../config";
import { openInBrowser } from "../lib/browser";
import { cmd } from "../lib/name";
import { resolveProject, resolveResource } from "../lib/resolve";
import { abort, dim, interactive, note, out } from "../lib/ui";

// Slug of the org that owns the project. Dashboard paths are org-scoped.
// Cached in the user config; on a miss, derived the same way the web shell
// does (session's activeOrganizationId, else first org) and persisted so
// subsequent opens skip the two auth round-trips.
async function resolveOrgSlug(url: string): Promise<string> {
  const cached = loadConfig().orgSlug;
  if (cached) return cached;

  const token = resolveToken();
  if (!token) {
    abort("Not authenticated.", `run \`${cmd("whoami")}\` to check your session`);
  }
  const auth = createCliAuthClient(url);
  const fetchOptions = { headers: { Authorization: `Bearer ${token}` } };
  const [orgs, session] = await Promise.all([
    auth.organization.list({ fetchOptions }),
    auth.getSession({ fetchOptions }),
  ]);
  const organizations = orgs.data ?? [];
  const activeId = session.data?.session.activeOrganizationId;
  const org = organizations.find((o) => o.id === activeId) ?? organizations[0];
  if (!org) {
    abort("This account has no organizations yet.", "create one in the dashboard first");
  }
  saveConfig({ ...loadConfig(), orgSlug: org.slug });
  return org.slug;
}

export const openCommand = defineCommand({
  meta: {
    name: "open",
    description: "Open the project (or one of its resources) in the dashboard",
  },
  args: {
    service: {
      type: "positional",
      required: false,
      description: "Service or database name (omit for the project overview)",
    },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
  },
  async run({ args }) {
    // Keep the resource context in its own binding so its `resourceId` stays
    // typed (a `ProjectContext | ResourceContext` union collapses it away).
    const resource = args.service ? await resolveResource(args, args.service) : null;
    const ctx = resource ?? (await resolveProject(args));
    const orgSlug = await resolveOrgSlug(ctx.url);

    // Web origin diverges from the API origin in dev; single-domain
    // installs fall back to the control plane URL.
    const base = (loadConfig().webUrl ?? ctx.url).replace(/\/$/, "");
    const suffix = resource ? `/graph/${resource.resourceId}` : "";
    const target = `${base}/${orgSlug}/${ctx.projectSlug}${suffix}`;

    // The URL goes to stdout bare so `otd open` is usable in a subshell; the
    // "opening" line is a diagnostic and stays off stdout.
    if (interactive()) {
      note(`Opening ${dim(target)}`);
      openInBrowser(target);
      return;
    }
    out(target);
  },
});
