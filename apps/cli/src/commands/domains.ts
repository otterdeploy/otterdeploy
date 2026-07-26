import { defineCommand } from "citty";

import type { CliClient } from "../lib/resolve";

import { relativeTime } from "../lib/format";
import { cmd } from "../lib/name";
import { resolveResource } from "../lib/resolve";
import { suggestions } from "../lib/suggest";
import {
  abort,
  confirm,
  detail,
  dim,
  err,
  hint,
  note,
  ok,
  out,
  paint,
  row,
  section,
  stateGlyph,
  stateLabel,
  table,
  warn,
} from "../lib/ui";

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
    // Show the real inventory rather than a comma-spliced list, so the reader
    // can copy a hostname straight out of the failure.
    if (rows.length > 0) {
      err();
      for (const r of rows) row([stateGlyph(r.dnsState), r.domain]);
      err();
    }
    abort(
      `No domain \`${domain}\` on this service.`,
      ...suggestions(
        needle,
        rows.map((r) => r.domain),
      ).map((s) => `did you mean \`${s}\`?`),
      ...(rows.length === 0 ? ["this service has no domains yet"] : []),
    );
  }
  return match;
}

/**
 * The three independent states a domain has, as their own block.
 *
 * They fail separately and are fixed separately: `status` is whether the route
 * is served at all, `dns` is whether the world points here, `cert` is whether
 * TLS was issued. Collapsing them into one line hid which of the three was
 * actually broken.
 */
function printDomainState(record: DomainRow): void {
  section("Domain");
  detail([
    ["domain", record.isPrimary ? `${record.domain} ${dim("(primary)")}` : record.domain],
    ["route", stateLabel(record.status)],
    [
      "dns",
      record.dnsCheckedAt
        ? `${stateLabel(record.dnsState)} ${dim(`checked ${relativeTime(record.dnsCheckedAt)}`)}`
        : stateLabel(record.dnsState),
    ],
    [
      "cert",
      record.certError
        ? `${stateLabel(record.certState)} ${paint("danger", record.certError)}`
        : stateLabel(record.certState),
    ],
  ]);
  out();
}

function printDnsInstructions(record: DomainRow, serviceName: string): void {
  if (record.status === "disabled") {
    warn("Service is not publicly exposed — the route stays disabled until it is.");
  }
  switch (record.dnsState) {
    case "pointed":
      return;
    case "proxied":
      note("Domain is behind a proxy (e.g. Cloudflare) — TLS is terminated there.");
      return;
    default: {
      if (record.dnsTarget) {
        note(`DNS is not pointed at this control plane yet.`);
        hint(`add an A record for ${record.domain} → ${record.dnsTarget}`);
      } else {
        note("DNS is not pointed yet.");
      }
      hint(`then run \`${cmd(`domains recheck ${record.domain} --service ${serviceName}`)}\``);
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
      note(`No domains on ${args.service}.`);
      hint(`run \`${cmd(`domains add <domain> --service ${args.service}`)}\``);
      return;
    }

    section(`Domains ${dim(args.service)}`);
    table(
      [
        { header: "" },
        { header: "domain" },
        { header: "route" },
        { header: "dns" },
        { header: "cert" },
      ],
      rows.map((r) => [
        // The primary domain is marked with the live glyph rather than an
        // asterisk, so it reads in the same vocabulary as every other row.
        r.isPrimary ? stateGlyph("running") : " ",
        r.domain,
        stateLabel(r.status),
        stateLabel(r.dnsState),
        stateLabel(r.certState),
      ]),
    );

    const target = rows.find((r) => r.dnsTarget)?.dnsTarget;
    const unpointed = rows.filter((r) => r.dnsState === "unpointed" || r.dnsState === "unknown");
    if (target && unpointed.length > 0) {
      out();
      note(`${unpointed.length} domain(s) need an A record to ${target}.`);
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
    const record = await ctx.client.service.domains.add({
      projectId: ctx.projectId,
      resourceId: ctx.resourceId,
      domain: args.domain,
    });
    ok(`Added ${record.domain} to ${ctx.resourceName}.`);
    printDomainState(record);
    printDnsInstructions(record, ctx.resourceName);
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
    const record = await findDomain(ctx.client, ctx.projectId, ctx.resourceId, args.domain);
    if (!args.yes) {
      // Removing the primary silently promotes another domain, which changes
      // where generated URLs point — say so before asking.
      const caveat = record.isPrimary ? " (primary — another domain will be promoted)" : "";
      const q = `Remove ${record.domain} from ${ctx.resourceName}${caveat}?`;
      if (!(await confirm(q))) abort("Aborted — nothing was removed.");
    }
    await ctx.client.service.domains.remove({
      projectId: ctx.projectId,
      resourceId: ctx.resourceId,
      routeId: record.id,
    });
    ok(`Removed ${record.domain} from ${ctx.resourceName}.`);
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
    const record = await findDomain(ctx.client, ctx.projectId, ctx.resourceId, args.domain);
    if (record.isPrimary) {
      note(`${record.domain} is already the primary domain.`);
      return;
    }
    const updated = await ctx.client.service.domains.setPrimary({
      projectId: ctx.projectId,
      resourceId: ctx.resourceId,
      routeId: record.id,
    });
    ok(`${updated.domain} is now primary for ${ctx.resourceName}.`);
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
    const record = await findDomain(ctx.client, ctx.projectId, ctx.resourceId, args.domain);
    const updated = await ctx.client.service.domains.recheck({
      projectId: ctx.projectId,
      resourceId: ctx.resourceId,
      routeId: record.id,
    });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(updated, null, 2)}\n`);
      return;
    }
    ok(`Rechecked ${updated.domain}.`);
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
