/**
 * A Docker Engine API stand-in on a unix socket, for the handful of swarm
 * endpoints the server-lifecycle writers call (swarm inspect / update, info,
 * node list / update), plus service list / create (the health-agent
 * reconciler) and a running-container list (server stats). Pointing DOCKER_HOST at it lets the REAL code paths
 * (join-token lookup, node verification, availability, join-credential
 * rotation) run end to end without a daemon; every knob is a field on
 * `state` the test flips to steer the outcome.
 */
import { rmSync } from "node:fs";
import * as z from "zod";

const serviceSpec = z.object({
  Name: z.string(),
  Labels: z.record(z.string(), z.string()).optional(),
});

export interface FakeNode {
  id: string;
  hostname: string;
  state: "ready" | "down";
  availability: "active" | "drain" | "pause";
  role: "manager" | "worker";
  version: number;
}

export interface FakeSwarmState {
  /** The local daemon is a swarm manager (otherwise /swarm answers 503). */
  swarm: boolean;
  /** `POST /swarm/update` (join-token rotation) answers 500. */
  rotateFails: boolean;
  /** `POST /nodes/:id/update` answers 500. */
  nodeUpdateFails: boolean;
  /** `GET /info` answers 500. */
  infoFails: boolean;
  nodes: FakeNode[];
  /** Swarm services, as `GET /services` lists them; `POST /services/create`
   *  appends. */
  services: Array<{ ID: string; Spec: { Name: string; Labels: Record<string, string> } }>;
  /** Running containers, as `GET /containers/json` lists them. */
  containers: Array<{ Id: string; Names: string[]; Labels: Record<string, string> }>;
  /** Every request seen, `METHOD /path`, for assertions. */
  seen: string[];
}

export interface FakeDockerd {
  socketPath: string;
  state: FakeSwarmState;
  stop: () => void;
}

function nodeBody(node: FakeNode) {
  return {
    ID: node.id,
    Version: { Index: node.version },
    Spec: { Role: node.role, Availability: node.availability, Labels: {} },
    Description: { Hostname: node.hostname },
    Status: { State: node.state, Addr: "10.0.0.2" },
  };
}

export function startFakeDockerd(socketPath: string): FakeDockerd {
  rmSync(socketPath, { force: true });
  const state: FakeSwarmState = {
    swarm: true,
    rotateFails: false,
    nodeUpdateFails: false,
    infoFails: false,
    nodes: [],
    services: [],
    containers: [],
    seen: [],
  };
  const server = Bun.serve({
    unix: socketPath,
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/v[0-9.]+/, "");
      state.seen.push(`${request.method} ${path}`);
      if (request.method === "GET" && path === "/swarm") {
        if (!state.swarm) return Response.json({ message: "not a swarm" }, { status: 503 });
        return Response.json({
          ID: "swarm-1",
          Version: { Index: 7 },
          Spec: { Name: "default", Orchestration: {}, Raft: {}, Dispatcher: {} },
          JoinTokens: { Worker: "SWMTKN-worker", Manager: "SWMTKN-manager" },
        });
      }
      if (request.method === "GET" && path === "/info" && state.infoFails)
        return Response.json({ message: "daemon unavailable" }, { status: 500 });
      if (request.method === "GET" && path === "/info")
        return Response.json({
          ID: "daemon-1",
          Swarm: state.swarm
            ? { NodeAddr: "10.0.0.1", LocalNodeState: "active", ControlAvailable: true }
            : { LocalNodeState: "inactive" },
        });
      if (request.method === "POST" && path === "/swarm/update")
        return state.rotateFails
          ? Response.json({ message: "rotation refused" }, { status: 500 })
          : new Response(null, { status: 200 });
      if (request.method === "GET" && path === "/nodes")
        return Response.json(state.nodes.map((node) => nodeBody(node)));
      const update = /^\/nodes\/([^/]+)\/update$/.exec(path);
      if (request.method === "POST" && update) {
        if (state.nodeUpdateFails)
          return Response.json({ message: "update refused" }, { status: 500 });
        const node = state.nodes.find((n) => n.id === update[1]);
        if (!node) return Response.json({ message: "no such node" }, { status: 404 });
        node.version += 1;
        return new Response(null, { status: 200 });
      }
      if (request.method === "GET" && path === "/services") {
        if (!state.swarm) return Response.json({ message: "not a swarm" }, { status: 503 });
        return Response.json(state.services);
      }
      if (request.method === "POST" && path === "/services/create") {
        if (!state.swarm) return Response.json({ message: "not a swarm" }, { status: 503 });
        const spec = serviceSpec.parse(await request.json());
        const id = `svc-${state.services.length + 1}`;
        state.services.push({ ID: id, Spec: { Name: spec.Name, Labels: spec.Labels ?? {} } });
        return Response.json({ ID: id }, { status: 201 });
      }
      if (request.method === "GET" && path === "/containers/json")
        return Response.json(
          state.containers.map((c) => ({ ...c, State: "running", Status: "Up 1 minute" })),
        );
      return Response.json({ message: `fake dockerd: ${request.method} ${path}` }, { status: 404 });
    },
  });
  return {
    socketPath,
    state,
    stop: () => {
      void server.stop(true);
      rmSync(socketPath, { force: true });
    },
  };
}
