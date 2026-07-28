/**
 * Install an edge proxy on a provisioned node.
 *
 * Every node terminates traffic for the services it runs, instead of one proxy
 * on the control-plane host fronting the whole cluster. With a single edge, a
 * manager outage takes every site down — the workers' containers keep running
 * and become unreachable, because nothing anywhere else is listening on :443.
 * Coolify settled on the same answer: a proxy container per managed server,
 * with traffic going straight to the server running the app rather than
 * through the control plane.
 *
 * The trade this accepts: a domain becomes bound to the machine serving it, so
 * moving a service between nodes also moves its DNS. That is the cost of not
 * having one host in the path of every request.
 *
 * Best-effort, exactly like the CrowdSec bouncer alongside it — a node that
 * joined successfully must never be failed by an edge that didn't install. The
 * caller narrates and continues.
 */

import type { SshSession } from "./ssh-exec";

import { PLATFORM } from "../../constants";

/** Container name on the node. Distinct from the control plane's compose-managed
 *  `otterdeploy-caddy-1` so the two can never be confused by name matching. */
export const NODE_PROXY_CONTAINER = `${PLATFORM.swarm.caddyContainer}-node`;

/** Exit code the script uses when docker isn't usable — narrated by the script. */
export const PROXY_UNSUPPORTED_EXIT = 78;

export interface NodeProxyTarget {
  /** "none" means we have no way to run privileged commands — skip entirely. */
  privilege: "root" | "sudo" | "none";
  /** Image reference, matching the control plane's own caddy build. */
  image: string;
  /** Overlay/bridge networks the proxy must join to reach service containers. */
  networks?: readonly string[];
}

/**
 * Idempotent install script. Pure so it can be asserted directly — see
 * provision-node-proxy.test.ts.
 *
 * Starts the proxy with a bootstrap config that answers 503 rather than
 * nothing: an edge that is up but has no routes yet should say so, not refuse
 * the connection. The control plane pushes the real config afterwards.
 */
export function nodeProxyInstallScript(target: NodeProxyTarget, sudo = ""): string {
  const S = sudo ? `${sudo} ` : "";
  const name = NODE_PROXY_CONTAINER;
  const networkFlags = (target.networks ?? []).map((n) => `--network ${n}`).join(" ");
  return [
    `if ! command -v docker >/dev/null 2>&1; then`,
    `  echo "docker not available on this node — skipping edge proxy"`,
    `  exit ${PROXY_UNSUPPORTED_EXIT}`,
    "fi",
    // Re-provisioning must converge, not stack a second listener on :443.
    `${S}docker rm -f ${name} >/dev/null 2>&1 || true`,
    `${S}mkdir -p /etc/otterdeploy/edge`,
    // A bare "no routes yet" responder. Replaced wholesale by the control
    // plane's reconciled Caddyfile once this node owns a service.
    `if [ ! -s /etc/otterdeploy/edge/Caddyfile ]; then`,
    `  printf '{\\n  admin 0.0.0.0:2019\\n}\\n:80 {\\n  respond "no services on this node yet" 503\\n}\\n' | ${S}tee /etc/otterdeploy/edge/Caddyfile >/dev/null`,
    "fi",
    `${S}docker run -d --name ${name} --restart unless-stopped \\`,
    `  -p 80:80 -p 443:443 -p 443:443/udp \\`,
    `  -v /etc/otterdeploy/edge:/etc/caddy \\`,
    `  -v otterdeploy-edge-data:/data -v otterdeploy-edge-config:/config \\`,
    `  ${networkFlags} \\`,
    `  --label otterdeploy.managed=true --label otterdeploy.role=edge \\`,
    `  ${target.image} caddy run --config /etc/caddy/Caddyfile --adapter caddyfile`,
    `echo "edge proxy running as ${name}"`,
  ].join("\n");
}

export async function installNodeProxy(
  session: SshSession,
  target: NodeProxyTarget,
  onLine: (line: string) => void,
): Promise<void> {
  if (target.privilege === "none") return;
  onLine("── installing edge proxy ──");
  const sudo = target.privilege === "sudo" ? "sudo" : "";
  const res = await session.runScript(nodeProxyInstallScript(target, sudo), onLine);
  if (res.exitCode === PROXY_UNSUPPORTED_EXIT) return; // narrated by the script
  if (res.exitCode !== 0) {
    onLine(
      "⚠ edge proxy install failed — the node joined fine, but it cannot serve traffic on its own. Services placed here will only be reachable while the control-plane edge is up.",
    );
    return;
  }
  onLine(`✓ edge proxy running (${NODE_PROXY_CONTAINER}) — this node can serve its own traffic`);
}
