/**
 * od-5j8.11, layered VPS firewall: swarm control-plane ports are never
 * exposed to the world in the generated host-firewall rules.
 *
 * Invariant under test: the rendered nftables ruleset gates 2377 (raft/mgmt),
 * 7946 (gossip tcp+udp) and 4789 (vxlan) behind the `otterdeploy_peers` named
 * set (never a bare `accept` reachable from any source) while SSH and
 * 80/443 (the platform's only public ingress) are unconditionally allowed,
 * and the default policy is drop. Also covers the DOCKER-USER defense-in-
 * depth guard (Docker-published ports can't bypass the policy) and the
 * peer-set builder's fail-closed-on-typo posture.
 */
import { describe, expect, test } from "vite-plus/test";

import {
  DOCKER_USER_GUARD_COMMENT,
  dockerUserGuardScript,
  EDGE_TCP_PORTS,
  filterIpv4Peers,
  hostFirewallInstallScript,
  isFirewallDrifted,
  OTTERDEPLOY_NFT_TABLE,
  OTTERDEPLOY_PEER_SET,
  parseHostFirewallStatus,
  renderNftablesRuleset,
  SWARM_TCP_PORTS,
  SWARM_UDP_PORTS,
} from "../../routers/server/host-firewall";

describe("[od-5j8.11] renderNftablesRuleset: default-deny baseline", () => {
  const rules = renderNftablesRuleset({ sshPort: 22, peerIpsV4: ["10.0.0.2", "10.0.0.3"] });

  test("declares the table with a drop-by-default input policy", () => {
    expect(rules).toContain(`table inet ${OTTERDEPLOY_NFT_TABLE} {`);
    expect(rules).toContain("type filter hook input priority filter; policy drop;");
  });

  test("every swarm control-plane port is scoped to the peer set, never a bare accept", () => {
    for (const port of new Set(SWARM_TCP_PORTS)) {
      const line = rules
        .split("\n")
        .find((l) => l.includes("tcp dport") && l.includes(String(port)));
      expect(line, `no tcp rule for port ${port}`).toBeDefined();
      expect(line).toContain(`ip saddr @${OTTERDEPLOY_PEER_SET}`);
    }
    for (const port of new Set(SWARM_UDP_PORTS)) {
      const line = rules
        .split("\n")
        .find((l) => l.includes("udp dport") && l.includes(String(port)));
      expect(line, `no udp rule for port ${port}`).toBeDefined();
      expect(line).toContain(`ip saddr @${OTTERDEPLOY_PEER_SET}`);
    }
  });

  test("no rule grants the swarm ports a world-reachable accept (no unscoped 'tcp dport { 2377' / '7946' / '4789' line)", () => {
    const worldReachable = rules
      .split("\n")
      .filter(
        (l) =>
          /dport.*\b(2377|7946|4789)\b/.test(l) && !l.includes(`ip saddr @${OTTERDEPLOY_PEER_SET}`),
      );
    expect(worldReachable).toEqual([]);
  });

  test("80/443 and the given SSH port ARE unconditionally reachable (the platform's real ingress)", () => {
    expect(rules).toContain(`tcp dport { ${EDGE_TCP_PORTS.join(", ")} } accept`);
    expect(rules).toContain("tcp dport 22 accept");
  });

  test("a non-standard SSH port is honored exactly, not hardcoded to 22", () => {
    const custom = renderNftablesRuleset({ sshPort: 2222, peerIpsV4: [] });
    expect(custom).toContain("tcp dport 2222 accept");
    expect(custom).not.toContain("tcp dport 22 accept");
  });

  test("established/related connections and loopback survive regardless of the rest of the ruleset (lockout guard)", () => {
    expect(rules).toContain("ct state established,related accept");
    expect(rules).toContain('iif "lo" accept');
  });

  test("an empty peer list declares the set with no elements, not a wildcard. Swarm ports are unreachable by anyone on a single-node install", () => {
    const single = renderNftablesRuleset({ sshPort: 22, peerIpsV4: [] });
    expect(single).not.toContain("elements =");
  });

  test("peer IPs are deduplicated in the rendered set", () => {
    const dup = renderNftablesRuleset({ sshPort: 22, peerIpsV4: ["10.0.0.2", "10.0.0.2"] });
    const elementsLine = dup.split("\n").find((l) => l.includes("elements ="));
    expect(elementsLine).toBe("\t\telements = { 10.0.0.2 }");
  });
});

describe("[od-5j8.11] DOCKER-USER guard: Docker-published ports cannot bypass policy", () => {
  const guard = dockerUserGuardScript("sudo");

  test("drops NEW forwarded connections to anything but 80/443, ahead of Docker's own permissive rules", () => {
    expect(guard).toContain("nft insert rule ip filter DOCKER-USER");
    expect(guard).toContain(`tcp dport != { ${EDGE_TCP_PORTS.join(", ")} }`);
    expect(guard).toContain("ct state new");
    expect(guard).toContain("drop");
  });

  test("scopes the drop to DNAT'd (inbound published) traffic, never container egress", () => {
    // DOCKER-USER is on the forward hook, so it also carries container EGRESS.
    // Without this qualifier the guard dropped every outbound connection a
    // container opened to a port outside the allowlist. Including the control
    // plane's own ssh to a host it was provisioning, which surfaced as
    // "SSH connection timed out" against a box whose port 22 was open.
    expect(guard).toContain("ct status dnat");
    const insert = guard
      .split("\n")
      .find((l) => l.includes("nft insert rule ip filter DOCKER-USER"));
    expect(insert).toBeDefined();
    expect(insert?.indexOf("ct status dnat")).toBeLessThan(insert?.indexOf("tcp dport !=") ?? -1);
  });

  test("is idempotent: deletes any prior otterdeploy-tagged rule (by comment) before inserting", () => {
    expect(guard).toContain(DOCKER_USER_GUARD_COMMENT);
    expect(guard).toContain("nft delete rule ip filter DOCKER-USER handle");
  });

  test("skips gracefully (never fails) when DOCKER-USER doesn't exist yet", () => {
    expect(guard).toContain("if sudo nft list chain ip filter DOCKER-USER");
    expect(guard).toContain("Guard skipped");
  });
});

describe("[od-5j8.11] hostFirewallInstallScript: end-to-end script composition", () => {
  const script = hostFirewallInstallScript({ sshPort: 22, peerIpsV4: ["10.0.0.2"] }, "sudo");

  test("never applies alongside an already-active ufw or firewalld (no fighting the operator's own choice)", () => {
    expect(script).toContain("ufw status");
    expect(script).toContain("firewall-cmd --state");
    expect(script).toMatch(/ufw is active[\s\S]*exit 0/);
  });

  test("validates the ruleset with 'nft -c -f' before ever applying it live", () => {
    expect(script).toContain("nft -c -f /etc/nftables-otterdeploy.conf");
    expect(script.indexOf("nft -c -f")).toBeLessThan(
      script.lastIndexOf("nft -f /etc/nftables-otterdeploy.conf"),
    );
  });

  test("persists across reboots via an nftables.conf include, without clobbering existing content", () => {
    expect(script).toContain('include "/etc/nftables-otterdeploy.conf"');
    expect(script).toContain("if [ -f /etc/nftables.conf ]");
  });

  test("embeds the DOCKER-USER guard and drops a status marker on success", () => {
    expect(script).toContain("DOCKER-USER");
    expect(script).toContain("OTTER_FW_STATUS=applied");
  });
});

describe("[od-5j8.11] parseHostFirewallStatus", () => {
  test("reads both markers independently", () => {
    expect(parseHostFirewallStatus("OTTER_FW_TABLE=present\nOTTER_FW_BOUNCER=active")).toEqual({
      tablePresent: true,
      bouncerActive: true,
    });
    expect(parseHostFirewallStatus("OTTER_FW_TABLE=absent\nOTTER_FW_BOUNCER=inactive")).toEqual({
      tablePresent: false,
      bouncerActive: false,
    });
  });

  test("defaults closed on garbage/empty output", () => {
    expect(parseHostFirewallStatus("")).toEqual({ tablePresent: false, bouncerActive: false });
  });
});

describe("[od-5j8.11] filterIpv4Peers: fail-closed-on-typo peer resolution", () => {
  test("keeps bare IPv4 literals and strips a trailing port", () => {
    expect(filterIpv4Peers(["10.0.0.2", "10.0.0.3:2377"])).toEqual(["10.0.0.2", "10.0.0.3"]);
  });

  test("drops hostnames, IPv6, and garbage rather than guessing", () => {
    expect(
      filterIpv4Peers(["node.example.com", "fd00::1", "not-an-ip", null, undefined, ""]),
    ).toEqual([]);
  });

  test("deduplicates", () => {
    expect(filterIpv4Peers(["10.0.0.2", "10.0.0.2:22"])).toEqual(["10.0.0.2"]);
  });
});

describe("[od-5j8.11] isFirewallDrifted: DB-tracked classifier", () => {
  test("a node that never ran the firewall step ('unknown') is drifted", () => {
    expect(isFirewallDrifted({ firewallStatus: "unknown", firewallBouncerActive: false })).toBe(
      true,
    );
  });

  test("a node whose firewall install failed is drifted", () => {
    expect(isFirewallDrifted({ firewallStatus: "failed", firewallBouncerActive: false })).toBe(
      true,
    );
  });

  test("applied + bouncer active is NOT drifted", () => {
    expect(isFirewallDrifted({ firewallStatus: "applied", firewallBouncerActive: true })).toBe(
      false,
    );
  });

  test("'applied' status but an inactive bouncer IS still drifted. Half the layering isn't protected", () => {
    expect(isFirewallDrifted({ firewallStatus: "applied", firewallBouncerActive: false })).toBe(
      true,
    );
  });

  test("'unsupported' (operator's own ufw/firewalld took precedence) is not drift by itself, as long as the bouncer covers it", () => {
    expect(isFirewallDrifted({ firewallStatus: "unsupported", firewallBouncerActive: true })).toBe(
      false,
    );
  });
});
