/**
 * Cost guard and cost accounting, from Hetzner's live pricing API.
 *
 * Gate (before anything is created): a run may live at most
 * LAB_MAX_RUN_MINUTES (its `expires` label), so its worst case is the
 * topology's hourly price times that. Refuse when that single-run maximum
 * exceeds LAB_BUDGET_EUR / 10, i.e. one runaway run can never eat more than a
 * tenth of the month.
 */
import { Result } from "better-result";

import type { HcloudClient, Pricing } from "./hcloud";
import type { LabTopology } from "./topology";

import { LabError, type LabResult } from "./support";

export interface HourlyPrice {
  net: number;
  gross: number;
}

export interface TopologyCost {
  perNode: { name: string; serverType: string; location: string; hourly: HourlyPrice }[];
  hourly: HourlyPrice;
}

/** Hourly price of one server incl. its primary IPv4, or null if Hetzner lists none. */
export function hourlyFor(
  pricing: Pricing,
  serverType: string,
  location: string,
): HourlyPrice | null {
  const server = pricing.server_types
    .find((t) => t.name === serverType)
    ?.prices.find((p) => p.location === location)?.price_hourly;
  if (!server) return null;
  // Every node has a primary IPv4, billed separately from the server.
  const ip = pricing.primary_ips
    .find((p) => p.type === "ipv4")
    ?.prices.find((p) => p.location === location)?.price_hourly;
  return {
    net: Number(server.net) + Number(ip?.net ?? 0),
    gross: Number(server.gross) + Number(ip?.gross ?? 0),
  };
}

export async function topologyCost(
  hcloud: HcloudClient,
  topology: LabTopology,
): Promise<LabResult<TopologyCost>> {
  const pricing = await hcloud.pricing();
  if (pricing.isErr()) return Result.err(pricing.error);
  const perNode: TopologyCost["perNode"] = [];
  for (const node of topology.nodes) {
    const hourly = hourlyFor(pricing.value, node.serverType, node.location);
    if (!hourly) {
      return Result.err(
        new LabError("budget", `no price for ${node.serverType} in ${node.location}`),
      );
    }
    perNode.push({ name: node.name, serverType: node.serverType, location: node.location, hourly });
  }
  const hourly = perNode.reduce(
    (sum, node) => ({ net: sum.net + node.hourly.net, gross: sum.gross + node.hourly.gross }),
    { net: 0, gross: 0 },
  );
  return Result.ok({ perNode, hourly });
}

export function checkBudget(
  cost: TopologyCost,
  maxRunMinutes: number,
  budgetEur: number,
): LabResult<string> {
  const runMax = cost.hourly.gross * (maxRunMinutes / 60);
  const ceiling = budgetEur / 10;
  const line =
    `topology ${eur(cost.hourly.gross)}/h gross; a full ${maxRunMinutes} min run costs at most ` +
    `${eur(runMax)} (ceiling ${eur(ceiling)} = LAB_BUDGET_EUR/10)`;
  return runMax > ceiling
    ? Result.err(new LabError("budget", `refused: ${line}`))
    : Result.ok(line);
}

/** Hetzner bills every started hour per server (capped monthly). */
export function billedCost(
  hourly: HourlyPrice,
  lifetimeSeconds: number,
): HourlyPrice & { hours: number } {
  const hours = Math.max(1, Math.ceil(lifetimeSeconds / 3600));
  return { hours, net: hourly.net * hours, gross: hourly.gross * hours };
}

export function eur(value: number): string {
  return `EUR ${value.toFixed(4)}`;
}
