/**
 * The end-to-end smoke run: up, install with the real public installer,
 * bootstrap the first admin, add w1 through the product, deploy a public image,
 * capture evidence, and ALWAYS tear down (try/finally), whatever failed.
 */
import { Result } from "better-result";
import { randomBytes } from "node:crypto";

import type { LabEnv } from "./env";
import type { SmokeContext } from "./smoke-context";
import type { RunState } from "./state";
import type { LabResult } from "./support";

import { eur, type HourlyPrice } from "./budget";
import { Evidence } from "./evidence";
import { ControlPlane } from "./product";
import { addWorker, deployWhoami } from "./smoke-cluster";
import { inboundExposure } from "./smoke-exposure";
import {
  bootstrapAdmin,
  healthAndSignIn,
  type InstallMode,
  installOtterdeploy,
} from "./smoke-install";
import { updateReplacesOldGuard } from "./smoke-update-guard";
import { LabSsh } from "./ssh";
import { nowInstant, secondsSince } from "./support";
import { teardownRun } from "./teardown";
import { TOPOLOGIES } from "./topology";
import { labUp } from "./up";

interface SmokeStep {
  name: string;
  run: (ctx: SmokeContext) => Promise<LabResult<string>>;
  /** A blocking step's failure stops the run; a non-blocking one is recorded
   *  and the independent steps after it still run (e only needs c, not d). */
  blocking: boolean;
}

const STEPS: SmokeStep[] = [
  { name: "b. install (real public installer)", run: installOtterdeploy, blocking: true },
  { name: "c. bootstrap first admin", run: bootstrapAdmin, blocking: true },
  { name: "c. /health + sign-in", run: healthAndSignIn, blocking: true },
  { name: "c2. inbound exposure + container egress", run: inboundExposure, blocking: false },
  { name: "c3. update replaces a pre-fix guard", run: updateReplacesOldGuard, blocking: false },
  { name: "d. add w1 via server.provision", run: addWorker, blocking: false },
  { name: "e. deploy traefik/whoami + fetch", run: deployWhoami, blocking: true },
];

const NODE_EVIDENCE: [string, string][] = [
  ["docker-ps.txt", "docker ps -a --format 'table {{.Names}}\\t{{.Image}}\\t{{.Status}}'"],
  ["docker-service-ls.txt", "docker service ls 2>&1 || true"],
  ["docker-info-swarm.txt", "docker info --format '{{json .Swarm}}' 2>&1 || true"],
  ["nft-ruleset.txt", "nft list ruleset 2>&1 | head -200 || true"],
];

async function collectEvidence(ctx: SmokeContext): Promise<void> {
  for (const node of ctx.state.nodes) {
    for (const [file, command] of NODE_EVIDENCE) {
      const out = await ctx.ssh.exec(node.ipv4, command, 60_000);
      ctx.evidence.write(
        `${node.name}-${file}`,
        out.isOk() ? `${out.value.stdout}${out.value.stderr}` : out.error.message,
      );
    }
  }
  const services = await ctx.ssh.exec(
    ctx.cpNode.ipv4,
    "docker service ps $(docker service ls -q) --no-trunc 2>&1 | head -60",
    60_000,
  );
  if (services.isOk()) ctx.evidence.write("cp-docker-service-ps.txt", services.value.stdout);
  const servers = await ctx.cp.call("server.list", () => ctx.cp.rpc.server.list({}));
  ctx.evidence.json(
    "api-server-list.json",
    servers.isOk() ? servers.value : { error: servers.error.message },
  );
}

/** b–f against a live run. Returns the first failed step's name, or null. */
async function runSteps(
  env: LabEnv,
  state: RunState,
  evidence: Evidence,
  installMode: InstallMode,
  localInstaller: string | null,
): Promise<string | null> {
  const cpNode = state.nodes.find((n) => n.name === "cp");
  const w1Node = state.nodes.find((n) => n.name === "w1");
  if (!cpNode || !w1Node) return "a. up (topology missing cp/w1)";
  const password = randomBytes(18).toString("base64url");
  evidence.redactor.add(password);
  const ctx: SmokeContext = {
    state,
    ssh: new LabSsh(state.run),
    evidence,
    cp: new ControlPlane(`http://${cpNode.ipv4}:3000`, evidence.redactor),
    cpNode,
    w1Node,
    domain: `${state.run}.${env.LAB_DNS_SUFFIX}`,
    email: `owner@${state.run}.${env.LAB_DNS_SUFFIX}`,
    password,
    installedVersion: null,
    installMode,
    localInstaller,
    bootstrapToken: null,
  };
  let failedAt: string | null = null;
  for (const step of STEPS) {
    const result = await evidence.step(
      step.name,
      () => step.run(ctx),
      (detail) => detail,
    );
    if (result.isErr()) {
      failedAt ??= step.name;
      if (step.blocking) break;
    }
  }
  await evidence.step("f. capture evidence", async () => {
    await collectEvidence(ctx);
    return Result.ok(evidence.dir);
  });
  evidence.json("summary.json", {
    run: state.run,
    installedVersion: ctx.installedVersion,
    installer: localInstaller ?? "public",
    failedAt,
  });
  return failedAt;
}

function printSummary(
  run: string,
  evidence: Evidence,
  failedAt: string | null,
  cost: HourlyPrice | null,
) {
  console.log(`\nsmoke run ${run}: ${failedAt ? `FAILED at ${failedAt}` : "PASSED"}`);
  for (const t of evidence.timings) {
    const seconds = String(t.seconds).padStart(7);
    console.log(`  ${t.ok ? "ok  " : "FAIL"} ${t.step.padEnd(44)} ${seconds}s  ${t.detail}`);
  }
  if (cost) {
    console.log(
      `  cost: ${eur(cost.gross)} gross (${eur(cost.net)} net), Hetzner prices x started hours`,
    );
  }
  console.log(`  evidence: ${evidence.dir}`);
}

export async function smoke(
  env: LabEnv,
  installMode: InstallMode = "terminal",
  localInstaller: string | null = null,
): Promise<number> {
  const topology = TOPOLOGIES.smoke;
  if (!topology) return 1;
  const upStarted = nowInstant();
  const up = await labUp(env, topology);
  if (up.isErr()) {
    console.error(`smoke: a. up failed (${up.error.where}): ${up.error.message}`);
    return 1;
  }
  const state = up.value;
  const evidence = new Evidence(state.run);
  evidence.timings.push({
    step: "a. up (servers, network, firewall, ssh, dns)",
    ok: true,
    seconds: secondsSince(upStarted),
    detail: state.nodes.map((n) => `${n.fqdn} ${n.ipv4}`).join(", "),
  });
  let failedAt: string | null = "aborted";
  try {
    failedAt = await runSteps(env, state, evidence, installMode, localInstaller);
  } finally {
    // Teardown runs whatever happened above, including a thrown exception.
    const down = await evidence.step(
      "g. down + verify",
      () => teardownRun(env, state.run),
      (r) => `remaining ${JSON.stringify(r.remaining)}`,
    );
    evidence.json("teardown.json", down.isOk() ? down.value : { error: down.error.message });
    if (down.isErr()) failedAt ??= "g. down + verify";
    printSummary(state.run, evidence, failedAt, down.isOk() ? down.value.cost : null);
  }
  return failedAt ? 1 : 0;
}
