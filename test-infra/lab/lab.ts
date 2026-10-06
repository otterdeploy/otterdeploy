/**
 * otterdeploy QA lab: ephemeral Hetzner Cloud machines + Cloudflare DNS.
 *
 *   bun varlock run -p ./test-infra/lab -- bun test-infra/lab/lab.ts <command>
 *
 *   up [topology]   budget gate, then create the run (default topology: smoke)
 *                   and print it. Tears down on any failure.
 *   down [run]      delete everything labelled run=<id> and its tracked DNS
 *                   records, then verify nothing remains. With no id, uses the
 *                   only local run.
 *   sweep           delete every otterlab=1 resource past its `expires` label and
 *                   every *.<LAB_DNS_SUFFIX> record older than LAB_MAX_RUN_MINUTES.
 *   status          list live otterlab resources and lab DNS records.
 *   smoke [--unattended]
 *                   up, install, bootstrap, add w1, deploy, evidence, down. The
 *                   installer runs in an interactive (TTY) SSH session like an
 *                   operator's; --unattended runs it without a TTY.
 *
 * Design: research/adversarial-testing/09-vm-lab.md.
 */
import { loadLabEnv } from "./env";
import { smoke } from "./smoke";
import { keyPath, localRuns } from "./state";
import { status } from "./status";
import { RUN_ID_PATTERN } from "./support";
import { sweep, teardownRun } from "./teardown";
import { TOPOLOGIES, topologyNamed } from "./topology";
import { labUp } from "./up";

async function up(topologyName: string): Promise<number> {
  const topology = topologyNamed(topologyName);
  if (!topology) {
    console.error(
      `unknown topology ${topologyName} (known: ${Object.keys(TOPOLOGIES).join(", ")})`,
    );
    return 2;
  }
  const env = loadLabEnv();
  const result = await labUp(env, topology);
  if (result.isErr()) return 1;
  const state = result.value;
  console.log(`\nrun ${state.run} is up (expires ${state.expires}). SSH with:`);
  for (const node of state.nodes) {
    console.log(`  ssh -i ${keyPath(state.run)} root@${node.ipv4}   # ${node.fqdn}`);
  }
  console.log(
    `tear down: bun varlock run -p ./test-infra/lab -- bun test-infra/lab/lab.ts down ${state.run}`,
  );
  return 0;
}

async function down(runArg: string | undefined): Promise<number> {
  const runs = localRuns();
  const run = runArg ?? (runs.length === 1 ? runs[0] : undefined);
  if (!run || !RUN_ID_PATTERN.test(run)) {
    console.error(`usage: down <run>   (local runs: ${runs.join(", ") || "none"})`);
    return 2;
  }
  const result = await teardownRun(loadLabEnv(), run);
  return result.isOk() ? 0 : 1;
}

async function main(argv: string[]): Promise<number> {
  const [command, arg] = argv;
  switch (command) {
    case "up":
      return up(arg ?? "smoke");
    case "down":
      return down(arg);
    case "sweep":
      return (await sweep(loadLabEnv())).isOk() ? 0 : 1;
    case "status":
      return status(loadLabEnv());
    case "smoke":
      return smoke(loadLabEnv(), arg === "--unattended" ? "unattended" : "terminal");
    default:
      console.error(
        "usage: lab.ts up [topology] | down [run] | sweep | status | smoke [--unattended]",
      );
      return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
