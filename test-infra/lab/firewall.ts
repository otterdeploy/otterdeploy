/**
 * The run's Hetzner cloud firewall (public side only; the private network is
 * not filtered by Hetzner). Applied at server creation, so no lab machine is
 * ever reachable on 22/3000 from the internet at large.
 *
 *   22/tcp, 3000/tcp   the operator's egress IP (this machine)
 *   80, 443/tcp        anywhere (real clients, ACME validators)
 *   ICMP               anywhere
 *   all tcp/udp/esp    from the lab's own nodes (the product SSHes cp -> worker
 *                      to provision, and swarm runs on the public addresses)
 *
 * Swarm ports are otherwise left to the product's own nftables baseline,
 * because that baseline is under test.
 */
import { Result } from "better-result";

import type { FirewallRule } from "./hcloud";

import { LabError, type LabResult } from "./support";

const ANYWHERE = ["0.0.0.0/0", "::/0"];

export function baseRules(operatorIp: string): FirewallRule[] {
  const operator = [`${operatorIp}/32`];
  return [
    {
      direction: "in",
      protocol: "tcp",
      port: "22",
      source_ips: operator,
      description: "ssh from operator",
    },
    {
      direction: "in",
      protocol: "tcp",
      port: "3000",
      source_ips: operator,
      description: "dashboard from operator",
    },
    { direction: "in", protocol: "tcp", port: "80", source_ips: ANYWHERE, description: "http" },
    { direction: "in", protocol: "tcp", port: "443", source_ips: ANYWHERE, description: "https" },
    { direction: "in", protocol: "icmp", source_ips: ANYWHERE, description: "icmp" },
  ];
}

export function labRules(operatorIp: string, nodeIps: string[]): FirewallRule[] {
  const nodes = nodeIps.map((ip) => (ip.includes(":") ? `${ip}/128` : `${ip}/32`));
  return [
    ...baseRules(operatorIp),
    {
      direction: "in",
      protocol: "tcp",
      port: "1-65535",
      source_ips: nodes,
      description: "lab nodes tcp",
    },
    {
      direction: "in",
      protocol: "udp",
      port: "1-65535",
      source_ips: nodes,
      description: "lab nodes udp",
    },
    { direction: "in", protocol: "esp", source_ips: nodes, description: "lab nodes esp" },
  ];
}

/** This machine's public IPv4, as seen by Cloudflare (an IPv4 literal forces v4). */
export async function operatorIpv4(): Promise<LabResult<string>> {
  const response = await Result.tryPromise({
    try: async () =>
      (
        await fetch("https://1.1.1.1/cdn-cgi/trace", { signal: AbortSignal.timeout(15_000) })
      ).text(),
    catch: () => new LabError("operator ip", "could not reach 1.1.1.1"),
  });
  if (response.isErr()) return Result.err(response.error);
  const ip = /^ip=(\d+\.\d+\.\d+\.\d+)$/m.exec(response.value)?.[1];
  return ip ? Result.ok(ip) : Result.err(new LabError("operator ip", "no IPv4 in trace"));
}
