/**
 * `down` and `sweep`. Teardown is label-driven for Hetzner (servers first, so
 * firewalls and networks are no longer in use) and id-driven for DNS. Both end
 * with a verification pass that lists what is left and says so.
 */
import { Temporal } from "@otterdeploy/shared/temporal";
import { Result } from "better-result";

import type { LabEnv } from "./env";

import { billedCost, eur, hourlyFor } from "./budget";
import { labClients } from "./clients";
import {
  type HcloudClient,
  LAB_LABEL,
  RESOURCE_KINDS,
  type HServer,
  type LabelledResource,
} from "./hcloud";
import { loadState, removeRunDir } from "./state";
import { LabError, type LabResult, nowEpochSeconds, nowInstant } from "./support";

export interface TeardownReport {
  run: string;
  remaining: Record<string, number>;
  clean: boolean;
  cost: { net: number; gross: number } | null;
}

/** What the run's servers cost, from Hetzner's own prices and creation times. */
async function serverCost(hcloud: HcloudClient, servers: HServer[]) {
  const pricing = await hcloud.pricing();
  if (pricing.isErr() || servers.length === 0) return null;
  const total = { net: 0, gross: 0 };
  for (const server of servers) {
    const location = server.datacenter?.location.name ?? server.location?.name ?? "";
    const hourly = hourlyFor(pricing.value, server.server_type.name, location) ?? {
      net: 0,
      gross: 0,
    };
    const lifetime = nowInstant().since(Temporal.Instant.from(server.created)).total("seconds");
    const billed = billedCost(hourly, lifetime);
    console.log(
      `  ${server.name}: ${Math.round(lifetime / 60)} min, billed ${billed.hours} h = ${eur(billed.gross)} gross`,
    );
    total.net += billed.net;
    total.gross += billed.gross;
  }
  return total;
}

async function deleteAll(
  hcloud: HcloudClient,
  matches: (r: LabelledResource) => boolean,
  selector: string,
) {
  const failures: string[] = [];
  for (const kind of RESOURCE_KINDS) {
    const listed = await hcloud.list(kind, selector);
    if (listed.isErr()) {
      failures.push(listed.error.message);
      continue;
    }
    const targets = listed.value.filter(matches);
    const results = await Promise.all(targets.map((r) => hcloud.remove(kind, r.id)));
    for (const [i, result] of results.entries()) {
      if (result.isErr()) failures.push(`${kind} ${targets[i]?.name}: ${result.error.message}`);
      else console.log(`  deleted ${kind} ${targets[i]?.name}`);
    }
  }
  return failures;
}

async function countLeft(
  hcloud: HcloudClient,
  selector: string,
  matches: (r: LabelledResource) => boolean,
) {
  const remaining: Record<string, number> = {};
  for (const kind of RESOURCE_KINDS) {
    const listed = await hcloud.list(kind, selector);
    remaining[kind] = listed.isOk() ? listed.value.filter(matches).length : -1;
  }
  return remaining;
}

export async function teardownRun(env: LabEnv, run: string): Promise<LabResult<TeardownReport>> {
  const { hcloud, dns } = labClients(env);
  const selector = `${LAB_LABEL}=1,run=${run}`;
  console.log(`tearing down run ${run}`);

  const servers = await hcloud.listServers(selector);
  const cost = servers.isOk() ? await serverCost(hcloud, servers.value) : null;
  const failures = await deleteAll(hcloud, () => true, selector);

  // DNS: exactly the record ids this run created and tracked.
  const state = loadState(run);
  const tracked = state.isOk() && state.value ? state.value.dnsRecords : [];
  for (const record of tracked) {
    const deleted = await dns.deleteById(record.id, (name) => dns.isRunName(name, run));
    if (deleted.isErr()) failures.push(deleted.error.message);
    else
      console.log(`  deleted dns ${record.name}${deleted.value === null ? " (already gone)" : ""}`);
  }
  // Records of this run that the state file lost track of (a crash between
  // create and save): only ones carrying OUR marker comment, still by id.
  const lab = await dns.listLab();
  const untracked = lab.isOk()
    ? lab.value.filter(
        (r) => dns.isRunName(r.name, run) && r.comment?.startsWith(`otterlab run=${run} `),
      )
    : [];
  for (const record of untracked) {
    const deleted = await dns.deleteById(record.id, (name) => dns.isRunName(name, run));
    if (deleted.isErr()) failures.push(deleted.error.message);
    else console.log(`  deleted untracked dns ${record.name}`);
  }

  const remaining = await countLeft(hcloud, selector, () => true);
  const after = await dns.listLab();
  remaining.dns_records = after.isOk()
    ? after.value.filter((r) => dns.isRunName(r.name, run)).length
    : -1;
  const clean = Object.values(remaining).every((n) => n === 0);
  if (clean) removeRunDir(run);
  report(`run ${run}`, remaining, clean);
  if (cost)
    console.log(
      `  run cost (Hetzner prices, started hours): ${eur(cost.gross)} gross / ${eur(cost.net)} net`,
    );
  if (failures.length > 0) console.error(`  teardown errors:\n    ${failures.join("\n    ")}`);
  return clean
    ? Result.ok({ run, remaining, clean, cost })
    : Result.err(new LabError("down", `run ${run} not clean: ${JSON.stringify(remaining)}`));
}

function report(scope: string, remaining: Record<string, number>, clean: boolean) {
  const counts = Object.entries(remaining)
    .map(([kind, n]) => `${n} ${kind}`)
    .join(", ");
  console.log(`verify ${scope}: ${counts} remain${clean ? ". Nothing left." : ". NOT CLEAN."}`);
}

const isExpired = (now: number) => (r: LabelledResource) => {
  const expires = Number(r.labels.expires);
  // No valid expiry on an otterlab resource is itself a leak: sweep it.
  return !Number.isFinite(expires) || expires < now;
};

export async function sweep(env: LabEnv): Promise<LabResult<Record<string, number>>> {
  const { hcloud, dns } = labClients(env);
  const now = nowEpochSeconds();
  const selector = `${LAB_LABEL}=1`;
  console.log(`sweeping ${selector} resources with expires < ${now}`);
  const failures = await deleteAll(hcloud, isExpired(now), selector);

  const cutoff = nowInstant().subtract({ minutes: env.LAB_MAX_RUN_MINUTES });
  const lab = await dns.listLab();
  if (lab.isErr()) failures.push(lab.error.message);
  const stale = lab.isOk()
    ? lab.value.filter(
        (r) => Temporal.Instant.compare(Temporal.Instant.from(r.created_on), cutoff) < 0,
      )
    : [];
  for (const record of stale) {
    const deleted = await dns.deleteById(record.id, (name) => dns.isLabName(name));
    if (deleted.isErr()) failures.push(deleted.error.message);
    else console.log(`  deleted stale dns ${record.name}`);
  }

  const remaining = await countLeft(hcloud, selector, isExpired(nowEpochSeconds()));
  const after = await dns.listLab();
  remaining.dns_records = after.isOk()
    ? after.value.filter(
        (r) => Temporal.Instant.compare(Temporal.Instant.from(r.created_on), cutoff) < 0,
      ).length
    : -1;
  const clean = Object.values(remaining).every((n) => n === 0);
  report("sweep (expired only)", remaining, clean);
  if (failures.length > 0) console.error(`  sweep errors:\n    ${failures.join("\n    ")}`);
  return clean
    ? Result.ok(remaining)
    : Result.err(new LabError("sweep", JSON.stringify(remaining)));
}
