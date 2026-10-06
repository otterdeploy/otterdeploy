/**
 * Smoke steps d and e: add w1 through the product's own SSH-provision flow
 * (managed key + server.provision, exactly what the Add server dialog calls),
 * then deploy one public image service and fetch it over HTTP.
 */
import { Result } from "better-result";
import * as z from "zod";

import type { SmokeContext } from "./smoke-context";

import { describeCause, LabError, type LabResult, pollUntil } from "./support";

const TRANSIENT = /ECONNRESET|ECONNREFUSED|socket connection was closed|fetch failed/i;

export async function addWorker(ctx: SmokeContext): Promise<LabResult<string>> {
  const { cp, ssh, evidence, w1Node } = ctx;
  const key = await cp.call("sshKeys.generate", () =>
    cp.rpc.sshKeys.generate({ name: `lab-${ctx.state.run}-nodes`, type: "ed25519" }),
  );
  if (key.isErr()) return Result.err(key.error);
  evidence.json("api-ssh-keys-generate.json", key.value);

  // What the operator does by hand: put the shown public key on the new host.
  const authorized = await ssh.exec(
    w1Node.ipv4,
    "umask 077 && mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys",
    30_000,
    `${key.value.publicKey.trim()}\n`,
  );
  if (authorized.isErr()) return Result.err(authorized.error);

  const created = await cp.call("server.provision", () =>
    cp.rpc.server.provision({
      name: "w1",
      host: w1Node.ipv4,
      sshKeyId: key.value.id,
      role: "worker",
    }),
  );
  if (created.isErr()) return Result.err(created.error);
  evidence.json("api-server-provision.json", created.value);
  const serverId = created.value.id;

  const stop = new AbortController();
  const logs = Result.tryPromise(async () => {
    const stream = await cp.rpc.server.provisionLogs({ id: serverId }, { signal: stop.signal });
    for await (const line of stream) evidence.append("provision-w1.log", `${line.ts} ${line.line}`);
  });

  const settled = await pollUntil("server ready", 20 * 60_000, 5_000, async () => {
    const server = await cp.call("server.get", () => cp.rpc.server.get({ id: serverId }));
    // A dropped keep-alive socket mid-provision is the poll's transport, not
    // the product's answer: ask again rather than fail the step on it.
    if (server.isErr() && TRANSIENT.test(server.error.message)) return Result.ok(undefined);
    if (server.isErr()) return Result.err(server.error);
    const { provisionStatus, provisionError } = server.value;
    if (provisionStatus === "failed") {
      evidence.json("api-server-get-failed.json", server.value);
      return Result.err(
        new LabError("provision", `w1 provisioning failed: ${provisionError ?? "(no reason)"}`),
      );
    }
    return Result.ok(provisionStatus === "ready" ? server.value : undefined);
  });
  stop.abort();
  await logs;
  if (settled.isErr()) return Result.err(settled.error);
  evidence.json("api-server-get-ready.json", settled.value);

  // Cross-check the product's "ready" against the swarm itself.
  const nodes = await ssh.must(ctx.cpNode.ipv4, "docker node ls --format '{{json .}}'");
  if (nodes.isErr()) return Result.err(nodes.error);
  evidence.write("cp-docker-node-ls.jsonl", nodes.value);
  const nodeRow = z.object({ Hostname: z.string(), Status: z.string(), Availability: z.string() });
  const rows = nodes.value
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => nodeRow.safeParse(Result.try((): unknown => JSON.parse(line)).unwrapOr(null)));
  const joined = rows.find((row) => row.success && row.data.Hostname === w1Node.serverName);
  if (!joined?.success || joined.data.Status !== "Ready") {
    return Result.err(
      new LabError("cross-check", `w1 (${w1Node.serverName}) is not a Ready swarm node on cp`),
    );
  }
  const local = await ssh.must(w1Node.ipv4, "docker info --format '{{.Swarm.LocalNodeState}}'");
  if (local.isErr()) return Result.err(local.error);
  if (local.value.trim() !== "active") {
    return Result.err(new LabError("cross-check", `w1 swarm state is ${local.value.trim()}`));
  }
  return Result.ok(
    `server ${serverId} ready; swarm node ${w1Node.serverName} Ready/${joined.data.Availability}`,
  );
}

export async function deployWhoami(ctx: SmokeContext): Promise<LabResult<string>> {
  const { cp, evidence } = ctx;
  const project = await cp.call("project.create", () =>
    cp.rpc.project.create({ name: "Smoke", slug: "smoke" }),
  );
  if (project.isErr()) return Result.err(project.error);
  evidence.json("api-project-create.json", project.value);
  const projectId = project.value.id;

  const service = await cp.call("service.create", () =>
    cp.rpc.service.create({
      projectId,
      name: "whoami",
      source: "image",
      image: "traefik/whoami:v1.10",
      replicas: 1,
      ports: [{ containerPort: 80, appProtocol: "http", isPrimary: true }],
    }),
  );
  if (service.isErr()) return Result.err(service.error);
  evidence.json("api-service-create.json", service.value);
  const resourceId = service.value.id;

  const exposed = await cp.call("service.expose", () =>
    cp.rpc.service.expose({ projectId, resourceId, allowGeneratedDomain: true }),
  );
  if (exposed.isErr()) return Result.err(exposed.error);
  evidence.json("api-service-expose.json", exposed.value);
  const domain = exposed.value.publicDomain;
  if (!domain) return Result.err(new LabError("expose", "service exposed without a public domain"));

  const running = await pollUntil("service running", 10 * 60_000, 5_000, async () => {
    const current = await cp.call("service.get", () =>
      cp.rpc.service.get({ projectId, resourceId }),
    );
    if (current.isErr()) return Result.err(current.error);
    return Result.ok(current.value.runtime.status === "running" ? current.value : undefined);
  });
  if (running.isErr()) return Result.err(running.error);
  evidence.json("api-service-running.json", running.value);

  const fetched = await pollUntil("http fetch", 3 * 60_000, 5_000, () => fetchWhoami(domain));
  if (fetched.isErr()) return Result.err(fetched.error);
  evidence.write("whoami-response.txt", fetched.value);
  return Result.ok(`${domain} answered: ${fetched.value.split("\n")[0] ?? ""}`);
}

/** Plain HTTP first; if the edge redirects to HTTPS (sslip hosts use Caddy's
 *  internal CA), follow it without trusting that CA. */
async function fetchWhoami(domain: string): Promise<LabResult<string | undefined>> {
  const attempt = await Result.tryPromise({
    try: async () => {
      for (const url of [`http://${domain}/`, `https://${domain}/`]) {
        const response = await fetch(url, {
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
          tls: { rejectUnauthorized: false },
        });
        const body = await response.text();
        if (response.ok && body.includes("Hostname:"))
          return `${url} -> ${response.status}\n${body}`;
      }
      return undefined;
    },
    catch: (cause) => new LabError("http fetch", describeCause(cause)),
  });
  // Connection errors while the route converges are "not yet", not fatal.
  return Result.ok(attempt.unwrapOr(undefined));
}
