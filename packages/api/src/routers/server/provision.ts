/**
 * Remote-host provisioning steps — the bash a fresh host runs to become a
 * swarm worker: probe → prerequisites → Docker → `docker swarm join`. The
 * script builders are pure (unit-tested); `runRemoteProvision` sequences them
 * over a live `SshSession`. Manager-side concerns (ensuring the primary is a
 * swarm, minting the join token, verifying the node appeared) live in the job
 * that calls this — they use the local Docker socket, not SSH.
 *
 * Design: docs/designs/server-onboarding.md
 */

import type { LineSink, SshSession } from "./ssh-exec";

export type Privilege = "root" | "sudo" | "none";

export interface ProbeResult {
  osId: string;
  /** The host's own `hostname` — how it will appear in `docker node ls`, so the
   *  manager-side verify step can find the freshly-joined node. */
  hostname: string;
  privilege: Privilege;
  /** Docker server version, or "none" if not installed. */
  docker: string;
  /** Swarm LocalNodeState: "active" | "inactive" | "unknown". */
  swarmState: string;
}

// ─── pure script builders ───────────────────────────────────────────────────

/** Emit `OTTER_<KEY>=<value>` markers we parse back in `parseProbe`. Tolerant:
 *  every probe is best-effort so a missing tool never aborts the whole script. */
export function probeScript(): string {
  return [
    "set +e",
    ". /etc/os-release 2>/dev/null || true",
    'echo "OTTER_OS_ID=${ID:-unknown}"',
    'echo "OTTER_HOSTNAME=$(hostname 2>/dev/null || echo unknown)"',
    'if [ "$(id -u)" = "0" ]; then echo "OTTER_PRIV=root";',
    "elif sudo -n true 2>/dev/null; then echo \"OTTER_PRIV=sudo\";",
    'else echo "OTTER_PRIV=none"; fi',
    'if command -v docker >/dev/null 2>&1; then echo "OTTER_DOCKER=$(docker version --format "{{.Server.Version}}" 2>/dev/null || echo present)"; else echo "OTTER_DOCKER=none"; fi',
    'echo "OTTER_SWARM=$(docker info --format "{{.Swarm.LocalNodeState}}" 2>/dev/null || echo unknown)"',
  ].join("\n");
}

const PREREQ_PKGS = "curl wget git jq ca-certificates";

/** Install the base tooling get.docker.com and the join step need. Detects the
 *  package manager at runtime so we don't have to branch on the probed OS id. */
export function prereqScript(sudo: string): string {
  const S = sudo ? `${sudo} ` : "";
  return [
    "set -euo pipefail",
    `PKGS="${PREREQ_PKGS}"`,
    `if command -v apt-get >/dev/null 2>&1; then ${S}apt-get update -y && ${S}DEBIAN_FRONTEND=noninteractive apt-get install -y $PKGS;`,
    `elif command -v dnf >/dev/null 2>&1; then ${S}dnf install -y $PKGS;`,
    `elif command -v yum >/dev/null 2>&1; then ${S}yum install -y $PKGS;`,
    `elif command -v pacman >/dev/null 2>&1; then ${S}pacman -Sy --noconfirm $PKGS;`,
    `elif command -v zypper >/dev/null 2>&1; then ${S}zypper install -y $PKGS;`,
    `elif command -v apk >/dev/null 2>&1; then ${S}apk add $PKGS;`,
    'else echo "no supported package manager (apt/dnf/yum/pacman/zypper/apk) found" >&2; exit 1; fi',
    'echo "prerequisites ready"',
  ].join("\n");
}

/** Install Docker Engine via the official convenience script (idempotent — skips
 *  if already present), then enable + start the daemon. */
export function dockerInstallScript(sudo: string): string {
  const S = sudo ? `${sudo} ` : "";
  return [
    "set -euo pipefail",
    "if command -v docker >/dev/null 2>&1; then",
    '  echo "docker already installed: $(docker --version)"',
    "else",
    '  echo "installing docker via get.docker.com…"',
    `  curl -fsSL https://get.docker.com | ${S}sh`,
    "fi",
    `${S}systemctl enable --now docker 2>/dev/null || true`,
    "docker --version",
  ].join("\n");
}

/** Join the shared swarm. `managerAddr` is "<ip>:2377"; `token` is the worker
 *  (or manager) join token — both sourced from OUR daemon, never operator
 *  input. Leaves any pre-existing swarm first so a re-provision is clean. When
 *  `advertiseAddr` is set (mesh mode) the node advertises its mesh IP so overlay
 *  traffic between nodes rides the mesh, not the public interface. */
export function swarmJoinScript(
  token: string,
  managerAddr: string,
  sudo: string,
  advertiseAddr?: string | null,
): string {
  const S = sudo ? `${sudo} ` : "";
  const advertise = advertiseAddr ? ` --advertise-addr ${advertiseAddr}` : "";
  return [
    "set -euo pipefail",
    "STATE=$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo unknown)",
    'if [ "$STATE" = "active" ]; then',
    '  echo "node already in a swarm — leaving it first"',
    `  ${S}docker swarm leave --force || true`,
    "fi",
    `${S}docker swarm join --token ${token}${advertise} ${managerAddr}`,
    'echo "joined swarm"',
  ].join("\n");
}

export type MeshProvider = "tailscale" | "netbird";

/**
 * Install a WireGuard mesh agent and bring it up with the operator's key, then
 * echo the node's mesh IP as `OTTER_MESH_IP=`. Tailscale reports it via
 * `tailscale ip -4`; NetBird exposes it on the `wt0` interface. The mesh IP
 * becomes the swarm advertise address so inter-node traffic stays on the mesh.
 * `authKey` is a secret (the tailnet auth key / netbird setup key) — it's
 * single-quoted; keys are URL-safe base64-ish and never contain a quote.
 */
export function meshInstallScript(
  provider: MeshProvider,
  authKey: string,
  sudo: string,
  managementUrl?: string | null,
): string {
  const S = sudo ? `${sudo} ` : "";
  if (provider === "tailscale") {
    return [
      "set -euo pipefail",
      "if ! command -v tailscale >/dev/null 2>&1; then",
      `  curl -fsSL https://tailscale.com/install.sh | ${S}sh`,
      "fi",
      `${S}tailscale up --authkey='${authKey}' --accept-dns=false`,
      "IP=",
      "for _ in $(seq 1 15); do",
      `  IP=$(${S}tailscale ip -4 2>/dev/null | head -1 || true)`,
      '  [ -n "$IP" ] && break',
      "  sleep 1",
      "done",
      'echo "OTTER_MESH_IP=${IP}"',
    ].join("\n");
  }
  // netbird
  const mgmt = managementUrl ? ` --management-url ${managementUrl}` : "";
  return [
    "set -euo pipefail",
    "if ! command -v netbird >/dev/null 2>&1; then",
    `  curl -fsSL https://pkgs.netbird.io/install.sh | ${S}sh`,
    "fi",
    `${S}netbird up --setup-key '${authKey}'${mgmt}`,
    "IP=",
    "for _ in $(seq 1 15); do",
    "  IP=$(ip -4 -o addr show wt0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1 || true)",
    '  [ -n "$IP" ] && break',
    "  sleep 1",
    "done",
    'echo "OTTER_MESH_IP=${IP}"',
  ].join("\n");
}

export function parseMeshAddress(output: string): string | null {
  const m = output.match(/^OTTER_MESH_IP=(.*)$/m);
  const ip = m?.[1]?.trim();
  return ip ? ip : null;
}

/**
 * Install Cloudflare Tunnel (cloudflared) as a host-network container running
 * the operator's tunnel — the Coolify pattern for reaching a NAT'd server / an
 * ingress path without opening ports. `token` is the connector token (secret).
 * Requires Docker (runs after the Docker step).
 */
export function cloudflaredInstallScript(token: string, sudo: string): string {
  const S = sudo ? `${sudo} ` : "";
  return [
    "set -euo pipefail",
    `${S}docker rm -f otter-cloudflared >/dev/null 2>&1 || true`,
    `${S}docker run -d --name otter-cloudflared --restart always --network host \\`,
    `  cloudflare/cloudflared:latest tunnel --no-autoupdate run --token ${token}`,
    'echo "cloudflared tunnel started"',
  ].join("\n");
}

/** Append our managed public key to authorized_keys (password-bootstrap only).
 *  Idempotent via grep -qxF so a retry doesn't duplicate the line. */
export function authorizedKeyScript(publicKey: string): string {
  return [
    "set -euo pipefail",
    "mkdir -p ~/.ssh && chmod 700 ~/.ssh",
    `KEY='${publicKey}'`,
    'grep -qxF "$KEY" ~/.ssh/authorized_keys 2>/dev/null || echo "$KEY" >> ~/.ssh/authorized_keys',
    "chmod 600 ~/.ssh/authorized_keys",
    'echo "managed SSH key installed"',
  ].join("\n");
}

// ─── probe parsing ───────────────────────────────────────────────────────────

export function parseProbe(output: string): ProbeResult {
  const get = (key: string): string => {
    const m = output.match(new RegExp(`^OTTER_${key}=(.*)$`, "m"));
    return m?.[1]?.trim() ?? "";
  };
  const rawPriv = get("PRIV");
  const privilege: Privilege =
    rawPriv === "root" ? "root" : rawPriv === "sudo" ? "sudo" : "none";
  return {
    osId: get("OS_ID") || "unknown",
    hostname: get("HOSTNAME") || "unknown",
    privilege,
    docker: get("DOCKER") || "none",
    swarmState: get("SWARM") || "unknown",
  };
}

// ─── orchestration ───────────────────────────────────────────────────────────

export interface RemoteProvisionInput {
  /** Set only for the password-bootstrap path: install this managed public key
   *  before doing anything else, so every later run can use key auth. */
  installPublicKey?: string;
  /** Worker (or manager) swarm join token from our daemon. */
  joinToken: string;
  /** "<ip>:2377" the new node dials to reach the manager. In mesh mode this is
   *  the manager's mesh address. */
  managerAddr: string;
  /** Install a WireGuard mesh agent before joining and advertise the node on
   *  its mesh IP. Omit for a public join. */
  mesh?: {
    provider: MeshProvider;
    /** Tailnet auth key / netbird setup key (secret). */
    authKey: string;
    /** Self-hosted netbird management URL; omit for the hosted service. */
    managementUrl?: string | null;
  };
  /** Install a Cloudflare Tunnel connector with this token (secret). */
  cloudflareTunnelToken?: string;
}

export interface RemoteProvisionResult {
  probe: ProbeResult;
  /** The node's mesh IP when a mesh provider ran, else null. */
  meshAddress: string | null;
}

function assertOk(result: { exitCode: number }, message: string): void {
  if (result.exitCode !== 0) throw new Error(`${message} (exit ${result.exitCode})`);
}

/**
 * Run the full remote provisioning sequence over an established session,
 * streaming every line to `onLine`. THROWS on the first fatal step (the job
 * wraps this in Result and records the failure). Returns the host probe +
 * mesh address for capacity/attribution.
 */
export async function runRemoteProvision(
  session: SshSession,
  input: RemoteProvisionInput,
  onLine: LineSink,
): Promise<RemoteProvisionResult> {
  if (input.installPublicKey) {
    onLine("── installing managed SSH key ──");
    assertOk(
      await session.runScript(authorizedKeyScript(input.installPublicKey), onLine),
      "failed to install managed SSH key",
    );
  }

  onLine("── probing host ──");
  const probe = parseProbe((await session.runScript(probeScript(), onLine)).output);
  if (probe.privilege === "none") {
    throw new Error(
      "the SSH user is neither root nor has passwordless sudo — grant sudo (or use root) and retry.",
    );
  }
  const sudo = probe.privilege === "sudo" ? "sudo" : "";

  onLine("── installing prerequisites ──");
  assertOk(await session.runScript(prereqScript(sudo), onLine), "prerequisite install failed");

  onLine("── installing Docker ──");
  assertOk(await session.runScript(dockerInstallScript(sudo), onLine), "Docker install failed");

  let meshAddress: string | null = null;
  if (input.mesh) {
    onLine(`── joining ${input.mesh.provider} mesh ──`);
    const meshRes = await session.runScript(
      meshInstallScript(input.mesh.provider, input.mesh.authKey, sudo, input.mesh.managementUrl),
      onLine,
    );
    assertOk(meshRes, `${input.mesh.provider} mesh join failed`);
    meshAddress = parseMeshAddress(meshRes.output);
    if (!meshAddress) {
      throw new Error(`${input.mesh.provider} came up but reported no mesh IP.`);
    }
    onLine(`mesh address: ${meshAddress}`);
  }

  if (input.cloudflareTunnelToken) {
    onLine("── installing Cloudflare Tunnel ──");
    assertOk(
      await session.runScript(cloudflaredInstallScript(input.cloudflareTunnelToken, sudo), onLine),
      "cloudflared install failed",
    );
  }

  onLine("── joining swarm ──");
  assertOk(
    await session.runScript(
      swarmJoinScript(input.joinToken, input.managerAddr, sudo, meshAddress),
      onLine,
    ),
    "docker swarm join failed",
  );

  onLine("── node joined; verifying on the manager… ──");
  return { probe, meshAddress };
}
