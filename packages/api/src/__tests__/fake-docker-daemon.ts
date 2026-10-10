/**
 * A Docker Engine API stand-in on a unix socket for the CONTAINER endpoints
 * the plain-Docker rollout drives (create / start / stop / rename / remove,
 * inspect + list, exec, logs, network connect / disconnect) and the SERVICE
 * endpoints the swarm update watch reads (service inspect / update, tasks).
 * Pointing DOCKER_HOST at it runs the real driver code end to end without a
 * daemon.
 *
 * Every container behaves as its test says: `exec` answers each exec'd
 * command, `logs` is its output, and its state is plain data the test flips.
 */
import { rmSync } from "node:fs";
import * as z from "zod";

const execBody = z.object({ Cmd: z.array(z.string()).optional() });
const createBody = z.object({
  Image: z.string().optional(),
  Labels: z.record(z.string(), z.string()).optional(),
  NetworkingConfig: z
    .object({
      EndpointsConfig: z
        .record(z.string(), z.object({ Aliases: z.array(z.string()).nullish() }).nullish())
        .optional(),
    })
    .optional(),
});
const connectBody = z.object({
  Container: z.string().optional(),
  EndpointConfig: z.object({ Aliases: z.array(z.string()).optional() }).nullish(),
});

export interface ExecAnswer {
  exitCode: number;
  stdout?: string;
  stderr?: string;
  /** Report the exec as still running when inspected (exit code unknown). */
  running?: boolean;
}

export interface FakeContainer {
  id: string;
  name: string;
  image: string;
  labels: Record<string, string>;
  status: "created" | "running" | "restarting" | "exited";
  exitCode: number;
  restartCount: number;
  health: string | null;
  healthLog: string[];
  networks: Record<string, { aliases: string[] }>;
  logs: string[];
  exec: (cmd: string[]) => ExecAnswer;
  /** The state `start` puts it in: `exited` for a version that dies at once. */
  startsAs: FakeContainer["status"];
}

export interface FakeService {
  id: string;
  name: string;
  version: number;
  updateState: string | null;
  updateMessage: string | null;
  /** UpdateStatus states served after an update, one per inspect (the last
   *  repeats), so a test scripts updating -> completed / rollback_completed. */
  afterUpdate: string[];
  afterRollback: string[];
  tasks: Array<{ state: string; err?: string; createdAt: string }>;
  updates: Array<{ rollback: string | null }>;
}

export interface FakeDockerDaemonState {
  containers: FakeContainer[];
  /** Docker networks that exist (`GET /networks`). */
  networks: Set<string>;
  /** Shapes every container the code under test creates. */
  onCreate: (c: FakeContainer) => void;
  services: FakeService[];
  /** Endpoints (`METHOD /path` after the version prefix) that answer 500. */
  failing: Set<string>;
  seen: string[];
}

export interface FakeDockerDaemon {
  socketPath: string;
  state: FakeDockerDaemonState;
  addContainer: (c: Partial<FakeContainer> & { name: string }) => FakeContainer;
  stop: () => void;
}

/** Docker's multiplexed stream framing: 8-byte header, then the payload. */
function frame(stream: 1 | 2, text: string): Uint8Array {
  const payload = Buffer.from(text, "utf8");
  const header = Buffer.alloc(8);
  header.writeUInt8(stream, 0);
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function filtersOf(url: URL): Record<string, string[]> {
  const raw = url.searchParams.get("filters");
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) return {};
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (Array.isArray(value)) out[key] = value.filter((v) => typeof v === "string");
  }
  return out;
}

function summary(c: FakeContainer) {
  return {
    Id: c.id,
    Names: [`/${c.name}`],
    Image: c.image,
    State: c.status,
    Status: c.status,
    Labels: c.labels,
    // Like the real Engine list response, health is available only via inspect.
  };
}

function inspect(c: FakeContainer) {
  return {
    Id: c.id,
    Name: `/${c.name}`,
    RestartCount: c.restartCount,
    State: {
      Status: c.status,
      Running: c.status === "running" || c.status === "restarting",
      Restarting: c.status === "restarting",
      OOMKilled: false,
      Dead: false,
      ExitCode: c.exitCode,
      ...(c.health
        ? { Health: { Status: c.health, Log: c.healthLog.map((Output) => ({ Output })) } }
        : {}),
    },
    Config: { Image: c.image, Labels: c.labels },
    NetworkSettings: {
      Networks: Object.fromEntries(
        Object.entries(c.networks).map(([name, n]) => [name, { Aliases: n.aliases }]),
      ),
    },
  };
}

const noContent = () => new Response(null, { status: 204 });
const notFound = (what: string) => Response.json({ message: `no such ${what}` }, { status: 404 });

export function startFakeDockerDaemon(socketPath: string): FakeDockerDaemon {
  rmSync(socketPath, { force: true });
  const state: FakeDockerDaemonState = {
    containers: [],
    networks: new Set(),
    onCreate: () => undefined,
    services: [],
    failing: new Set(),
    seen: [],
  };
  let ids = 0;
  const execs = new Map<string, { container: FakeContainer; cmd: string[]; answer?: ExecAnswer }>();

  const addContainer = (c: Partial<FakeContainer> & { name: string }): FakeContainer => {
    ids += 1;
    const container: FakeContainer = {
      id: `ctr${ids}`,
      image: "app:v1",
      labels: {},
      status: "running",
      exitCode: 0,
      restartCount: 0,
      health: null,
      healthLog: [],
      networks: {},
      logs: [],
      exec: () => ({ exitCode: 0 }),
      startsAs: "running",
      ...c,
    };
    state.containers.push(container);
    return container;
  };
  const byRef = (ref: string) =>
    state.containers.find(
      (c) => c.id === ref || c.name === ref || c.name === ref.replace(/^\//, ""),
    );

  // oxlint-disable-next-line max-lines-per-function, complexity -- one routing table for the fake daemon, read top to bottom
  function containerRoutes(request: Request, url: URL, path: string): Response | null {
    if (request.method === "GET" && path === "/containers/json") {
      const filters = filtersOf(url);
      const names = filters.name ?? [];
      const labels = filters.label ?? [];
      return Response.json(
        state.containers
          .filter((c) => names.every((n) => c.name.includes(n)))
          .filter((c) =>
            labels.every((l) => {
              const [key, value] = l.split("=");
              return (
                key !== undefined &&
                (value === undefined ? key in c.labels : c.labels[key] === value)
              );
            }),
          )
          .map(summary),
      );
    }
    if (request.method === "POST" && path === "/containers/create") return null;
    const m = /^\/containers\/([^/]+)(?:\/(json|start|stop|rename|exec|logs))?$/.exec(path);
    if (!m) return null;
    const c = byRef(decodeURIComponent(m[1] ?? ""));
    if (!c) return notFound("container");
    switch (`${request.method} ${m[2] ?? ""}`) {
      case "GET json":
        return Response.json(inspect(c));
      case "POST start":
        c.status = c.startsAs;
        if (c.startsAs === "exited") c.exitCode = 1;
        return noContent();
      case "POST stop":
        c.status = "exited";
        return noContent();
      case "POST rename": {
        const to = url.searchParams.get("name") ?? "";
        if (byRef(to)) return Response.json({ message: "name in use" }, { status: 409 });
        c.name = to;
        return noContent();
      }
      case "DELETE ":
        state.containers = state.containers.filter((x) => x !== c);
        return noContent();
      case "GET logs":
        return new Response(Buffer.concat(c.logs.map((l) => frame(1, `${l}\n`))));
      default:
        return null;
    }
  }

  async function execRoutes(request: Request, path: string): Promise<Response | null> {
    const create = /^\/containers\/([^/]+)\/exec$/.exec(path);
    if (request.method === "POST" && create) {
      const c = byRef(decodeURIComponent(create[1] ?? ""));
      if (!c) return notFound("container");
      const body = execBody.parse(await request.json());
      ids += 1;
      const id = `exec${ids}`;
      execs.set(id, { container: c, cmd: body.Cmd ?? [] });
      return Response.json({ Id: id }, { status: 201 });
    }
    const run = /^\/exec\/([^/]+)\/(start|json)$/.exec(path);
    if (!run) return null;
    const exec = execs.get(run[1] ?? "");
    if (!exec) return notFound("exec");
    if (run[2] === "start") {
      exec.answer = exec.container.exec(exec.cmd);
      const out = [frame(1, exec.answer.stdout ?? ""), frame(2, exec.answer.stderr ?? "")];
      return new Response(Buffer.concat(out), {
        headers: { "content-type": "application/vnd.docker.raw-stream" },
      });
    }
    return Response.json(
      exec.answer?.running
        ? { Running: true }
        : { Running: false, ExitCode: exec.answer?.exitCode ?? 0 },
    );
  }

  async function createRoute(request: Request, url: URL): Promise<Response> {
    const name = url.searchParams.get("name") ?? "";
    if (byRef(name)) {
      return Response.json(
        { message: `Conflict. The container name "/${name}" is already in use` },
        { status: 409 },
      );
    }
    const body = createBody.parse(await request.json());
    const networks = Object.fromEntries(
      Object.entries(body.NetworkingConfig?.EndpointsConfig ?? {}).map(([net, e]) => [
        net,
        { aliases: e?.Aliases ?? [] },
      ]),
    );
    const c = addContainer({
      name,
      image: body.Image ?? "",
      labels: body.Labels ?? {},
      status: "created",
      networks,
    });
    state.onCreate(c);
    return Response.json({ Id: c.id, Warnings: [] }, { status: 201 });
  }

  async function networkRoutes(request: Request, path: string): Promise<Response | null> {
    if (request.method === "GET" && path === "/networks") {
      return Response.json([...state.networks].map((Name) => ({ Name, Id: Name })));
    }
    const m = /^\/networks\/([^/]+)\/(connect|disconnect)$/.exec(path);
    if (!m || request.method !== "POST") return null;
    const network = decodeURIComponent(m[1] ?? "");
    const body = connectBody.parse(await request.json());
    const c = byRef(body.Container ?? "");
    if (!c) return notFound("container");
    if (m[2] === "disconnect") {
      if (!(network in c.networks))
        return Response.json({ message: "not connected" }, { status: 500 });
      delete c.networks[network];
    } else {
      c.networks[network] = { aliases: body.EndpointConfig?.Aliases ?? [] };
    }
    return new Response(null, { status: 200 });
  }

  async function serviceRoutes(request: Request, url: URL, path: string): Promise<Response | null> {
    if (request.method === "GET" && path === "/tasks") {
      const name = filtersOf(url).service?.[0];
      const svc = state.services.find((s) => s.name === name);
      return Response.json(
        (svc?.tasks ?? []).map((t) => ({
          CreatedAt: t.createdAt,
          Status: { State: t.state, ...(t.err ? { Err: t.err } : {}) },
        })),
      );
    }
    if (request.method === "GET" && path === "/services") {
      const name = filtersOf(url).name?.[0] ?? "";
      return Response.json(
        state.services
          .filter((s) => s.name.includes(name))
          .map((s) => ({ ID: s.id, Spec: { Name: s.name } })),
      );
    }
    const m = /^\/services\/([^/]+)(\/update)?$/.exec(path);
    if (!m) return null;
    const svc = state.services.find((s) => s.id === m[1] || s.name === m[1]);
    if (!svc) return notFound("service");
    if (request.method === "POST" && m[2]) {
      const rollback = url.searchParams.get("rollback");
      svc.updates.push({ rollback });
      svc.version += 1;
      svc.updateState = null;
      svc.afterUpdate = rollback ? [...svc.afterRollback] : svc.afterUpdate;
      return Response.json({ Warnings: [] });
    }
    // Each inspect advances the scripted UpdateStatus by one step.
    if (svc.afterUpdate.length > 0) {
      svc.updateState =
        svc.afterUpdate.length > 1
          ? (svc.afterUpdate.shift() ?? null)
          : (svc.afterUpdate[0] ?? null);
    }
    return Response.json({
      ID: svc.id,
      Version: { Index: svc.version },
      Spec: { Name: svc.name, Labels: {}, TaskTemplate: {}, Mode: { Replicated: { Replicas: 1 } } },
      ...(svc.updateState
        ? { UpdateStatus: { State: svc.updateState, Message: svc.updateMessage ?? "" } }
        : {}),
    });
  }

  const server = Bun.serve({
    unix: socketPath,
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/v[0-9.]+/, "");
      const key = `${request.method} ${path}`;
      state.seen.push(key);
      if (state.failing.has(key))
        return Response.json({ message: "injected failure" }, { status: 500 });
      if (request.method === "POST" && path === "/containers/create")
        return createRoute(request, url);
      const answer =
        (await execRoutes(request, path)) ??
        containerRoutes(request, url, path) ??
        (await networkRoutes(request, path)) ??
        (await serviceRoutes(request, url, path));
      return answer ?? Response.json({ message: `fake dockerd: ${key}` }, { status: 404 });
    },
  });
  return {
    socketPath,
    state,
    addContainer,
    stop: () => {
      void server.stop(true);
      rmSync(socketPath, { force: true });
    },
  };
}
