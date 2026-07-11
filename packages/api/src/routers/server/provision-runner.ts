/**
 * Provisioning runner — drives a fresh host from pending → ready. Runs as a
 * BullMQ `server.provision` job (handler wired in apps/server, which has the
 * manager socket + SSH). It mints the join token from the local manager socket,
 * installs a mesh agent if requested, SSHes out and runs the install+join steps
 * (`runRemoteProvision`), verifies the node in `docker node ls`, labels build
 * nodes, and advances the row's provisionStatus. Lines fan out over
 * `provision-stream.ts` for the live UI.
 *
 * `enqueueProvision` (called by the API handler) encrypts the secrets and
 * enqueues the job; `runProvisionJob` is the worker body. Secrets live in the
 * BullMQ payload as AES-GCM ciphertext so Redis never holds plaintext.
 * Design: docs/designs/server-onboarding.md
 */

import type { Node } from "@otterdeploy/docker";
import type { ProvisionServerPayload } from "@otterdeploy/jobs";
import type { OrganizationId, ServerId, SshKeyId } from "@otterdeploy/shared/id";

import { Docker } from "@otterdeploy/docker";
import { triggerProvisionServer } from "@otterdeploy/jobs";

import { decryptSecret, encryptSecret } from "../../lib/crypto";
import { getSshKeyInOrg } from "../sshKeys/queries";
import { getSwarmJoinTokens } from "./join-tokens";
import { type MeshProvider, runRemoteProvision } from "./provision";
import { emitProvisionLine, endProvisionStream } from "./provision-stream";
import { patchServerProvision } from "./queries";
import { SshSession } from "./ssh-exec";

const VERIFY_ATTEMPTS = 30;
const VERIFY_INTERVAL_MS = 2000;
const BUILD_NODE_LABEL = "otterdeploy.role";

export interface EnqueueProvisionInput {
  serverId: ServerId;
  organizationId: OrganizationId;
  host: string;
  sshUser: string;
  sshPort: number;
  role: "manager" | "worker";
  sshKeyId?: SshKeyId | null;
  buildServer: boolean;
  meshProvider: "none" | "tailscale" | "netbird";
  meshManagementUrl?: string | null;
  /** One-time secrets (plaintext here; encrypted into the job payload). */
  password?: string;
  meshAuthKey?: string;
  cloudflareToken?: string;
}

/** Encrypt the secrets and enqueue the provision job. */
export async function enqueueProvision(input: EnqueueProvisionInput): Promise<void> {
  const enc = (v: string | undefined) => (v ? encryptSecret(v) : Promise.resolve(null));
  const [passwordCiphertext, meshAuthKeyCiphertext, cloudflareTokenCiphertext] = await Promise.all([
    enc(input.password),
    enc(input.meshAuthKey),
    enc(input.cloudflareToken),
  ]);
  await triggerProvisionServer({
    serverId: input.serverId,
    organizationId: input.organizationId,
    host: input.host,
    sshUser: input.sshUser,
    sshPort: input.sshPort,
    role: input.role,
    sshKeyId: input.sshKeyId ?? null,
    buildServer: input.buildServer,
    meshProvider: input.meshProvider,
    meshManagementUrl: input.meshManagementUrl ?? null,
    passwordCiphertext,
    meshAuthKeyCiphertext,
    cloudflareTokenCiphertext,
  });
}

/** The BullMQ worker body. Records a terminal provisionStatus either way and
 *  never throws (attempts=1; the operator retries explicitly). */
export async function runProvisionJob(payload: ProvisionServerPayload): Promise<void> {
  const serverId = payload.serverId as ServerId;
  const organizationId = payload.organizationId as OrganizationId;
  const emit = (line: string) => emitProvisionLine(serverId, line);

  try {
    await patchServerProvision({
      serverId,
      organizationId,
      provisionStatus: "provisioning",
      provisionError: null,
    });

    // Manager join target from OUR daemon (throws with actionable messages).
    const { joinToken, managerAddr } = await resolveJoinTarget(payload.meshProvider, payload.role);

    // Decrypt secrets from the payload.
    const [password, meshAuthKey, cloudflareToken] = await Promise.all([
      decryptOptional(payload.passwordCiphertext),
      decryptOptional(payload.meshAuthKeyCiphertext),
      decryptOptional(payload.cloudflareTokenCiphertext),
    ]);

    const privateKey = await resolvePrivateKey(payload.sshKeyId, organizationId, password != null);
    if (payload.meshProvider !== "none" && !meshAuthKey) {
      throw new Error(`A ${payload.meshProvider} auth key is required to join over the mesh.`);
    }

    emit(`── connecting to ${payload.host}:${payload.sshPort} as ${payload.sshUser} ──`);
    const session = await SshSession.connect({
      host: payload.host,
      port: payload.sshPort,
      user: payload.sshUser,
      privateKey,
      password: password ?? undefined,
    });

    let result;
    try {
      result = await runRemoteProvision(
        session,
        {
          joinToken,
          managerAddr,
          mesh:
            payload.meshProvider === "none"
              ? undefined
              : {
                  provider: payload.meshProvider as MeshProvider,
                  authKey: meshAuthKey as string,
                  managementUrl: payload.meshManagementUrl,
                },
          cloudflareTunnelToken: cloudflareToken ?? undefined,
        },
        emit,
      );
    } finally {
      session.dispose();
    }

    await patchServerProvision({
      serverId,
      organizationId,
      provisionStatus: "joining",
      hostname: result.probe.hostname,
      meshAddress: result.meshAddress,
    });

    const node = await verifyNodeJoined(result.probe.hostname, emit);
    if (!node) {
      throw new Error(
        "The node ran `docker swarm join` but never appeared as ready in `docker node ls`. Check the manager is reachable from the new host on port 2377.",
      );
    }

    if (payload.buildServer) {
      emit("── labelling as a build node ──");
      await labelBuildNode(node, emit);
    }

    await patchServerProvision({
      serverId,
      organizationId,
      provisionStatus: "ready",
      status: "ready",
      provisionError: null,
      hostname: result.probe.hostname,
      daemonVersion: result.probe.docker === "none" ? null : result.probe.docker,
      meshAddress: result.meshAddress,
    });
    emit("✓ server ready");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit(`✗ provisioning failed: ${message}`);
    await patchServerProvision({
      serverId,
      organizationId,
      provisionStatus: "failed",
      provisionError: message,
      status: "down",
    }).catch(() => undefined);
  } finally {
    endProvisionStream(serverId);
  }
}

function decryptOptional(blob: string | null | undefined): Promise<string | null> {
  return blob ? decryptSecret(blob) : Promise.resolve(null);
}

/** Resolve the swarm join token + manager address from OUR daemon. We don't
 *  auto-init a swarm (the local ensureSwarm advertises loopback, unreachable
 *  for a remote join), so we require a routable/mesh swarm and say so. */
async function resolveJoinTarget(
  meshProvider: "none" | "tailscale" | "netbird",
  role: "manager" | "worker",
): Promise<{ joinToken: string; managerAddr: string }> {
  const tokens = await getSwarmJoinTokens();
  if (tokens.managerAddr === "—") {
    throw new Error(
      "The primary host isn't a Docker Swarm manager yet. Run in swarm mode (DEPLOY_RUNTIME=swarm) and deploy once so the swarm initialises, then add servers.",
    );
  }
  // A loopback manager address only works when the new node joins over a mesh
  // that carries the manager too — otherwise it's unreachable.
  if (meshProvider === "none" && /^(127\.|0\.0\.0\.0|::1\b|localhost)/.test(tokens.managerAddr)) {
    throw new Error(
      `The swarm advertises a loopback manager address (${tokens.managerAddr}); a remote node can't reach it. Re-initialise the swarm on the primary's routable/mesh IP, or add the server over a mesh.`,
    );
  }
  const joinToken = role === "manager" ? tokens.manager : tokens.worker;
  if (joinToken === "—") throw new Error("The daemon returned no swarm join token.");
  return { joinToken, managerAddr: tokens.managerAddr };
}

/** Managed key (decrypted) or one-time password. Returns the private key when a
 *  key is used, undefined for password auth. Throws if neither is present. */
async function resolvePrivateKey(
  sshKeyId: string | null | undefined,
  organizationId: OrganizationId,
  hasPassword: boolean,
): Promise<string | undefined> {
  if (sshKeyId) {
    const key = await getSshKeyInOrg({ id: sshKeyId as SshKeyId, organizationId });
    if (!key?.privateKeyCiphertext) {
      throw new Error("The selected SSH key has no private half stored — pick a generated key.");
    }
    return decryptSecret(key.privateKeyCiphertext);
  }
  if (!hasPassword) {
    throw new Error("No SSH credential supplied — choose a managed key or enter a password.");
  }
  return undefined;
}

/** Poll the local manager's `docker node ls` until a node with `hostname`
 *  reports ready; return the node so callers can label it. */
async function verifyNodeJoined(
  hostname: string,
  emit: (line: string) => void,
): Promise<Node | null> {
  const docker = Docker.fromEnv();
  try {
    for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
      const nodes = await docker.nodes.list({});
      if (nodes.isOk()) {
        const match = nodes.value.find((n) => n.Description?.Hostname === hostname);
        if (match?.Status?.State === "ready") return match;
        if (match) emit(`node ${hostname} present, state: ${match.Status?.State ?? "unknown"}…`);
      }
      await new Promise((r) => setTimeout(r, VERIFY_INTERVAL_MS));
    }
    return null;
  } finally {
    docker.destroy();
  }
}

/** Add the `otterdeploy.role=build` swarm label so build workloads can target
 *  this node. Carries the full existing NodeSpec (labels/role/availability) so
 *  the update doesn't clear anything. Best-effort: a label failure doesn't fail
 *  an otherwise-joined node. */
async function labelBuildNode(node: Node, emit: (line: string) => void): Promise<void> {
  if (!node.ID) return;
  const docker = Docker.fromEnv();
  try {
    const update = await docker.nodes.getNode(node.ID).update({
      version: node.Version?.Index ?? 0,
      ...(node.Spec?.Name !== undefined ? { Name: node.Spec.Name } : {}),
      ...(node.Spec?.Role !== undefined ? { Role: node.Spec.Role } : {}),
      ...(node.Spec?.Availability !== undefined ? { Availability: node.Spec.Availability } : {}),
      Labels: { ...node.Spec?.Labels, [BUILD_NODE_LABEL]: "build" },
    });
    if (update.isErr()) emit(`could not apply build label: ${update.error.message}`);
  } finally {
    docker.destroy();
  }
}
