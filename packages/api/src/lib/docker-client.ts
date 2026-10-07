/**
 * The Docker client for API request paths: list, inspect and stats calls that
 * answer a caller who is waiting.
 *
 * `Docker.fromEnv()` sets no timeout unless DOCKER_CLIENT_TIMEOUT is in the
 * environment (it never is in the shipped compose), so a daemon that accepts
 * the connection and never answers held every such request until the 120s
 * procedure deadline. This client bounds each request.
 *
 * Only for bounded request/response calls. The timeout is an IDLE-socket
 * timeout applied to every dial, so it would cut a quiet log follow, an
 * events stream, an image pull or a container wait: those keep their own
 * `Docker.fromEnv()` clients.
 */
import { Docker } from "@otterdeploy/docker";
import { env } from "@otterdeploy/env/server";

/**
 * Product default: 30s of silence on a request socket. A healthy daemon
 * answers a list or inspect in milliseconds and `system df` (sizes every
 * volume) in seconds on a large host, so 30s leaves wide headroom while still
 * answering well inside the procedure deadline. Override with
 * DOCKER_REQUEST_TIMEOUT_MS.
 */
export const DOCKER_REQUEST_TIMEOUT_MS = 30_000;

/** The request timeout in force: the env override, else the default. */
export function dockerRequestTimeoutMs(): number {
  return env.DOCKER_REQUEST_TIMEOUT_MS ?? DOCKER_REQUEST_TIMEOUT_MS;
}

/** A Docker client (DOCKER_HOST and TLS from the environment, like
 *  `Docker.fromEnv()`) whose every request is bounded. */
export function createRequestDockerClient(): Docker {
  return new Docker({ timeoutMs: dockerRequestTimeoutMs() });
}
