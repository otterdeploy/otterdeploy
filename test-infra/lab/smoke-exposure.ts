/**
 * Smoke step c2: what cp exposes to the internet after a default install, and
 * that its containers can still connect OUT (od-ckrq).
 *
 * Vantage: w1 BEFORE it joins. The Hetzner cloud firewall lets lab nodes reach
 * each other on every port, and cp's nftables peer set does not hold w1 yet, so
 * from w1 cp's own host firewall is the only filter: exactly what an arbitrary
 * internet client meets on a host with no cloud firewall in front of it.
 */
import { Result } from "better-result";

import type { SmokeContext } from "./smoke-context";

import { labRules } from "./firewall";
import { LabError, type LabResult } from "./support";

/** The host firewall must let exactly these through to a non-peer. "Through"
 *  is nmap's open OR closed: closed is a RST from behind the firewall (Caddy
 *  binds 80/443 only once it has a site), filtered is the firewall's drop. */
const EXPECTED_OPEN = [22, 80, 443, 3000];
const PUBLISHED_TEST_PORT = 8081;
const UNPUBLISHED_TEST_PORT = 8082;
const TEST_IMAGE = "traefik/whoami:v1.10";

export async function inboundExposure(ctx: SmokeContext): Promise<LabResult<string>> {
  const { ssh, evidence, cpNode, w1Node } = ctx;
  const cp = cpNode.ipv4;
  const w1 = w1Node.ipv4;

  // What the lab's cloud firewall allows, for the record (operator IP elided).
  evidence.json(
    "exposure-hetzner-firewall-rules.json",
    labRules("0.0.0.0", [cp, w1]).map((rule) => ({
      ...rule,
      source_ips: rule.source_ips.map((ip) => (ip === "0.0.0.0/32" ? "<operator>/32" : ip)),
    })),
  );

  // A container published on a port outside the allowlist (what the DOCKER-USER
  // guard exists to stop), and one listening without being published at all.
  const started = await ssh.must(
    cp,
    [
      "docker rm -f lab-published lab-unpublished >/dev/null 2>&1 || true",
      `docker run -d --name lab-published -p ${PUBLISHED_TEST_PORT}:${PUBLISHED_TEST_PORT} ${TEST_IMAGE} --port ${PUBLISHED_TEST_PORT} >/dev/null`,
      `docker run -d --name lab-unpublished ${TEST_IMAGE} --port ${UNPUBLISHED_TEST_PORT} >/dev/null`,
      "sleep 2",
      `echo "published-from-cp: $(curl -s -o /dev/null -w '%{http_code}' -m5 http://127.0.0.1:${PUBLISHED_TEST_PORT}/)"`,
      "ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' lab-unpublished)",
      `echo "unpublished-ip: $ip"`,
      `echo "unpublished-from-cp: $(curl -s -o /dev/null -w '%{http_code}' -m5 http://$ip:${UNPUBLISHED_TEST_PORT}/)"`,
      "nft list chain ip filter DOCKER-USER",
    ].join("\n"),
    5 * 60_000,
  );
  if (started.isErr()) return Result.err(started.error);
  evidence.write("exposure-cp-setup.txt", started.value);
  const unpublishedIp = /unpublished-ip: (\S+)/.exec(started.value)?.[1] ?? "";

  // Egress from a container on cp to w1:22, the connection "Add server" makes.
  const egress = await ssh.exec(
    cp,
    `docker run --rm --network otterdeploy alpine:3 nc -z -w 8 ${w1} 22 && echo EGRESS-OK || echo EGRESS-BLOCKED`,
    5 * 60_000,
  );
  const egressOut = egress.isOk() ? `${egress.value.stdout}${egress.value.stderr}` : "";
  evidence.write("exposure-container-egress.txt", egressOut);

  // Full TCP scan of cp from w1, plus the two test ports and the container IP.
  const scan = await ssh.exec(
    w1,
    [
      "export DEBIAN_FRONTEND=noninteractive",
      "command -v nmap >/dev/null || { apt-get update -qq && apt-get install -y -qq nmap; } >/dev/null 2>&1",
      `nmap -Pn -n -p- -T4 --max-rate 300 --max-retries 1 ${cp} -oG - | grep Ports: || true`,
      `nc -z -w 5 ${cp} ${PUBLISHED_TEST_PORT} && echo PUBLISHED-REACHABLE || echo PUBLISHED-BLOCKED`,
      `nc -z -w 5 ${cp} ${UNPUBLISHED_TEST_PORT} && echo UNPUBLISHED-REACHABLE || echo UNPUBLISHED-BLOCKED`,
      unpublishedIp
        ? `nc -z -w 5 ${unpublishedIp} ${UNPUBLISHED_TEST_PORT} && echo CONTAINER-IP-REACHABLE || echo CONTAINER-IP-BLOCKED`
        : "echo CONTAINER-IP-UNKNOWN",
    ].join("\n"),
    15 * 60_000,
  );
  if (scan.isErr()) return Result.err(scan.error);
  evidence.write("exposure-scan-from-w1.txt", `${scan.value.stdout}${scan.value.stderr}`);

  const after = await ssh.exec(
    cp,
    "nft list chain ip filter DOCKER-USER; nft list chain inet otterdeploy input; docker rm -f lab-published lab-unpublished >/dev/null 2>&1 || true",
    60_000,
  );
  if (after.isOk()) evidence.write("exposure-cp-after.txt", after.value.stdout);

  // Gentle on purpose: a 3000 pps scan tripped Hetzner's network protection and
  // cut both nodes off for ~2 minutes, failing the next step for no product reason.
  const open = [...scan.value.stdout.matchAll(/(\d+)\/(?:open|closed)\//g)].map((m) =>
    Number(m[1]),
  );
  const problems = exposureProblems(open, scan.value.stdout, egressOut, started.value);
  if (problems.length > 0) return Result.err(new LabError("exposure", problems.join("; ")));
  return Result.ok(
    `reachable from a non-peer: ${open.join(",")}; ${PUBLISHED_TEST_PORT} (published) and ${UNPUBLISHED_TEST_PORT} (unpublished) blocked; container egress to w1:22 ok`,
  );
}

/** Every way the observed exposure differs from the policy. Empty = as intended. */
function exposureProblems(open: number[], scan: string, egress: string, setup: string): string[] {
  const said = (marker: string, text: string) => new RegExp(`^${marker}$`, "m").test(text);
  const unexpected = open.filter((port) => !EXPECTED_OPEN.includes(port));
  const missing = EXPECTED_OPEN.filter((port) => !open.includes(port));
  const checks: [boolean, string][] = [
    [unexpected.length === 0, `unexpected reachable ports ${unexpected.join(",")}`],
    [missing.length === 0, `expected ports not reachable ${missing.join(",")}`],
    [said("PUBLISHED-BLOCKED", scan), `published ${PUBLISHED_TEST_PORT} not blocked`],
    [said("UNPUBLISHED-BLOCKED", scan), `unpublished ${UNPUBLISHED_TEST_PORT} not blocked`],
    [said("CONTAINER-IP-BLOCKED", scan), "container IP not blocked"],
    [said("EGRESS-OK", egress), "container egress to w1:22 blocked"],
    // Without these two the "blocked" results above would prove nothing.
    [said("published-from-cp: 200", setup), `${PUBLISHED_TEST_PORT} test container not serving`],
    [
      said("unpublished-from-cp: 200", setup),
      `${UNPUBLISHED_TEST_PORT} test container not serving`,
    ],
  ];
  return checks.filter(([ok]) => !ok).map(([, problem]) => problem);
}
