import { defineCommand } from "citty";
import { consola } from "consola";

import type { CliClient } from "../lib/resolve";

import { resolveResource } from "../lib/resolve";

type DomainRow = Awaited<ReturnType<CliClient["service"]["domains"]["list"]>>[number];

// Server normalizes domains (trim, lowercase, strip trailing dot) before
// storing — apply the same normalization so lookups by hostname match.
function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, "");
}

async function findDomain(
  client: CliClient,
  projectId: string,
  resourceId: string,
  domain: string,
): Promise<DomainRow> {
  const rows = await client.service.domains.list({ projectId, resourceId });
  const needle = normalizeDomain(domain);
  const match = rows.find((r) => r.domain === needle);
  if (!match) {
    const available = rows.map((r) => r.domain).join(", ") || "(none)";
    consola.error(`Domain ${domain} not found on this service. Available: ${available}`);
    process.exit(1);
  }
  return match;
}

function printDomainState(row: DomainRow): void {
  const primary = row.isPrimary ? " (primary)" : "";
  consola.log(`  domain:  ${row.domain}${primary}`);
  consola.log(`  status:  ${row.status}`);
  consola.log(
    `  dns:     ${row.dnsState}${row.dnsCheckedAt ? ` (checked ${row.dnsCheckedAt})` : ""}`,
  );
  consola.log(`  cert:    ${row.certState}${row.certError ? ` — ${row.certError}` : ""}`);
}

function printDnsInstructions(row: DomainRow, serviceName: string): void {
  if (row.status === "disabled") {
    consola.warn("Service is not publicly exposed — the route stays disabled until it is.");
  }
  switch (row.dnsState) {
    case "pointed":
      return;
    case "proxied":
      consola.info(
        "Domain appears to be behind a proxy (e.g. Cloudflare) — TLS is terminated there.",
      );
      return;
    default:
      if (row.dnsTarget) {
        consola.info(
          `Point an A record for ${row.domain} to ${row.dnsTarget}, then run ` +
            `\`otterdeploy domains recheck ${row.domain} --service ${serviceName}\`.`,
        );
      } else {
        consola.info(
          `DNS is not pointed yet — run \`otterdeploy domains recheck ${row.domain} ` +
            `--service ${serviceName}\` after updating your records.`,
        );
      }
  }
}

const listDomains = defineCommand({
  meta: { name: "list", description: "List domains for a service" },
  args: {
    service: { type: "string", required: true, description: "Service name" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const { client, projectId, resourceId } = await resolveResource(args, args.service, "service");
    const rows = await client.service.domains.list({ projectId, resourceId });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      return;
    }
    if (rows.length === 0) {
      consola.info(`No domains on ${args.service}. Add one with \`domains add <domain>\`.`);
      return;
    }
    const width = Math.max(...rows.map((r) => r.domain.length));
    for (const r of rows) {
      const primary = r.isPrimary ? "*" : " ";
      consola.log(
        `${primary} ${r.domain.padEnd(width)}  dns:${r.dnsState}  cert:${r.certState}  ${r.status}`,
      );
    }
    const target = rows.find((r) => r.dnsTarget)?.dnsTarget;
    if (target && rows.some((r) => r.dnsState === "unpointed" || r.dnsState === "unknown")) {
      consola.info(`Unpointed domains need an A record to ${target}.`);
    }
  },
});

const addDomain = defineCommand({
  meta: { name: "add", description: "Add a domain to a service" },
  args: {
    domain: { type: "positional", required: true, description: "Domain to add" },
    service: { type: "string", required: true, description: "Service name" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
  },
  async run({ args }) {
    const ctx = await resolveResource(args, args.service, "service");
    const row = await ctx.client.service.domains.add({
      projectId: ctx.projectId,
      resourceId: ctx.resourceId,
      domain: args.domain,
    });
    consola.success(`Added ${row.domain} to ${ctx.resourceName}.`);
    printDomainState(row);
    printDnsInstructions(row, ctx.resourceName);
  },
});

const removeDomain = defineCommand({
  meta: { name: "remove", description: "Remove a domain from a service" },
  args: {
    domain: { type: "positional", required: true, description: "Domain to remove" },
    service: { type: "string", required: true, description: "Service name" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    yes: { type: "boolean", description: "Skip confirmation prompts" },
  },
  async run({ args }) {
    const ctx = await resolveResource(args, args.service, "service");
    const row = await findDomain(ctx.client, ctx.projectId, ctx.resourceId, args.domain);
    if (!args.yes) {
      const note = row.isPrimary ? " (primary — another domain will be promoted)" : "";
      const ok = await consola.prompt(`Remove ${row.domain} from ${ctx.resourceName}${note}?`, {
        type: "confirm",
        initial: false,
      });
      if (!ok) {
        consola.info("Aborted.");
        process.exit(1);
      }
    }
    await ctx.client.service.domains.remove({
      projectId: ctx.projectId,
      resourceId: ctx.resourceId,
      routeId: row.id,
    });
    consola.success(`Removed ${row.domain} from ${ctx.resourceName}.`);
  },
});

const setPrimaryDomain = defineCommand({
  meta: { name: "set-primary", description: "Make a domain the service's primary domain" },
  args: {
    domain: { type: "positional", required: true, description: "Domain to promote" },
    service: { type: "string", required: true, description: "Service name" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
  },
  async run({ args }) {
    const ctx = await resolveResource(args, args.service, "service");
    const row = await findDomain(ctx.client, ctx.projectId, ctx.resourceId, args.domain);
    if (row.isPrimary) {
      consola.info(`${row.domain} is already the primary domain.`);
      return;
    }
    const updated = await ctx.client.service.domains.setPrimary({
      projectId: ctx.projectId,
      resourceId: ctx.resourceId,
      routeId: row.id,
    });
    consola.success(`${updated.domain} is now the primary domain for ${ctx.resourceName}.`);
  },
});

const recheckDomain = defineCommand({
  meta: { name: "recheck", description: "Re-run the DNS reachability check for a domain" },
  args: {
    domain: { type: "positional", required: true, description: "Domain to recheck" },
    service: { type: "string", required: true, description: "Service name" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const ctx = await resolveResource(args, args.service, "service");
    const row = await findDomain(ctx.client, ctx.projectId, ctx.resourceId, args.domain);
    const updated = await ctx.client.service.domains.recheck({
      projectId: ctx.projectId,
      resourceId: ctx.resourceId,
      routeId: row.id,
    });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(updated, null, 2)}\n`);
      return;
    }
    consola.success(`Rechecked ${updated.domain}.`);
    printDomainState(updated);
    printDnsInstructions(updated, ctx.resourceName);
  },
});

export const domainsCommand = defineCommand({
  meta: { name: "domains", description: "Manage service domains" },
  subCommands: {
    list: listDomains,
    add: addDomain,
    remove: removeDomain,
    "set-primary": setPrimaryDomain,
    recheck: recheckDomain,
  },
});
