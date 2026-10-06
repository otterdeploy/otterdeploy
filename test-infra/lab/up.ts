/**
 * `up`: budget gate, then key, network, firewall, servers, private IPs, SSH,
 * DNS. Any failure tears the run down before returning the error.
 */
import { Result } from "better-result";

import type { LabEnv } from "./env";
import type { LabTopology } from "./topology";

import { checkBudget, topologyCost } from "./budget";
import { labClients } from "./clients";
import { baseRules, labRules, operatorIpv4 } from "./firewall";
import { LAB_LABEL, type Labels } from "./hcloud";
import { LabSsh, generateKeyPair } from "./ssh";
import { type NodeState, type RunState, saveState } from "./state";
import { LabError, type LabResult, newRunId, nowEpochSeconds, nowInstant } from "./support";
import { teardownRun } from "./teardown";

export async function labUp(env: LabEnv, topology: LabTopology): Promise<LabResult<RunState>> {
  const { hcloud } = labClients(env);
  const cost = await topologyCost(hcloud, topology);
  if (cost.isErr()) return Result.err(cost.error);
  const gate = checkBudget(cost.value, env.LAB_MAX_RUN_MINUTES, env.LAB_BUDGET_EUR);
  if (gate.isErr()) return Result.err(gate.error);
  console.log(`budget ok: ${gate.value}`);

  const run = newRunId();
  const state: RunState = {
    run,
    topology: topology.name,
    expires: nowEpochSeconds() + env.LAB_MAX_RUN_MINUTES * 60,
    createdAt: nowInstant().toString(),
    hourlyGross: cost.value.hourly.gross,
    hourlyNet: cost.value.hourly.net,
    nodes: [],
    dnsRecords: [],
  };
  saveState(state);
  console.log(`run ${run}: expires ${state.expires} (in ${env.LAB_MAX_RUN_MINUTES} min)`);

  const built = await build(env, topology, state);
  if (built.isOk()) return built;
  console.error(
    `up failed (${built.error.where}): ${built.error.message}\ntearing run ${run} down`,
  );
  await teardownRun(env, run);
  return built;
}

/** Create every node in parallel, then (in order) wait, pin its private IP, and record it. */
async function createNodes(
  env: LabEnv,
  topology: LabTopology,
  state: RunState,
  base: { labels: Labels; sshKeyId: number; firewallId: number; networkId: number },
): Promise<LabResult<void>> {
  const { hcloud } = labClients(env);
  const created = await Promise.all(
    topology.nodes.map((node) =>
      hcloud.createServer({
        name: `${node.name}-${state.run}`,
        serverType: node.serverType,
        location: node.location,
        image: topology.image,
        sshKeyId: base.sshKeyId,
        firewallId: base.firewallId,
        labels: { ...base.labels, role: node.name },
      }),
    ),
  );
  return Result.gen(async function* () {
    for (const [index, node] of topology.nodes.entries()) {
      const createdNode = yield* (
        created[index] ?? Result.err(new LabError("up", `${node.name} missing`))
      );
      yield* Result.await(hcloud.waitAction(createdNode.actionId));
      if (node.privateIp) {
        yield* Result.await(
          hcloud.attachToNetwork(createdNode.server.id, base.networkId, node.privateIp),
        );
      }
      const server = yield* Result.await(hcloud.getServer(createdNode.server.id));
      const ipv4 = server.public_net.ipv4?.ip;
      if (!ipv4) return Result.err(new LabError("up", `${node.name} has no public IPv4`));
      const nodeState: NodeState = {
        name: node.name,
        role: node.role,
        serverId: server.id,
        serverName: server.name,
        serverType: node.serverType,
        location: node.location,
        ipv4,
        ipv6: server.public_net.ipv6?.ip ?? null,
        privateIp: server.private_net[0]?.ip ?? null,
        createdAt: server.created,
        fqdn: null,
      };
      state.nodes.push(nodeState);
      saveState(state);
      console.log(`  ${node.name}: ${server.name} ${ipv4} private ${nodeState.privateIp ?? "-"}`);
    }
    return Result.ok(undefined);
  });
}

/** One A record per node, tracked by id in the run state as soon as it exists. */
async function createDns(env: LabEnv, state: RunState): Promise<LabResult<void>> {
  const { dns } = labClients(env);
  for (const node of state.nodes) {
    const fqdn = `${node.name}.${state.run}.${env.LAB_DNS_SUFFIX}`;
    const comment = `otterlab run=${state.run} expires=${state.expires}`;
    const record = await dns.createA(state.run, fqdn, node.ipv4, comment);
    if (record.isErr()) return Result.err(record.error);
    state.dnsRecords.push({ id: record.value.id, name: record.value.name });
    node.fqdn = fqdn;
    saveState(state);
    console.log(`  dns ${fqdn} -> ${node.ipv4}`);
  }
  return Result.ok(undefined);
}

async function waitAllSsh(state: RunState): Promise<LabResult<void>> {
  const ssh = new LabSsh(state.run);
  const ready = await Promise.all(state.nodes.map((node) => ssh.waitReady(node.ipv4)));
  const failed = ready.find((result) => result.isErr());
  if (failed?.isErr()) return Result.err(failed.error);
  console.log("  ssh ready on all nodes");
  return Result.ok(undefined);
}

function build(env: LabEnv, topology: LabTopology, state: RunState): Promise<LabResult<RunState>> {
  const { hcloud } = labClients(env);
  const { run } = state;
  const labels: Labels = { [LAB_LABEL]: "1", run, expires: String(state.expires) };
  const name = `otterlab-${run}`;
  return Result.gen(async function* () {
    const publicKey = yield* Result.await(generateKeyPair(run));
    const operatorIp = yield* Result.await(operatorIpv4());
    const key = yield* Result.await(hcloud.createSshKey(name, publicKey.trim(), labels));
    const network = yield* Result.await(hcloud.createNetwork(name, topology.network, labels));
    const firewall = yield* Result.await(
      hcloud.createFirewall(name, baseRules(operatorIp), labels),
    );
    yield* Result.await(
      createNodes(env, topology, state, {
        labels,
        sshKeyId: key.id,
        firewallId: firewall.id,
        networkId: network.id,
      }),
    );
    const nodeIps = state.nodes.map((n) => n.ipv4);
    yield* Result.await(hcloud.setFirewallRules(firewall.id, labRules(operatorIp, nodeIps)));
    yield* Result.await(waitAllSsh(state));
    yield* Result.await(createDns(env, state));
    return Result.ok(state);
  });
}
