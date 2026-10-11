/**
 * Which streaming procedures ride the dashboard's live socket.
 *
 * A dashboard tab used to hold one HTTP request open per live stream: the org
 * event stream, the project event stream, a log tail or two. On a control plane
 * reached over plain HTTP/1.1 (the installer's `http://IP:3000` before a domain
 * is set) Chrome allows six connections per host, shared by every tab of the
 * profile, so two tabs left nothing for ordinary calls: panels stuck on
 * "Loading…" and an Apply click never reached the server.
 *
 * The streams listed here instead travel over ONE WebSocket per tab
 * (`/live/rpc`), where oRPC's peer protocol multiplexes them: subscribing sends
 * a request message, unsubscribing sends an abort, and the socket stays one
 * connection however many panels are open. A WebSocket is also outside the
 * browser's per-host HTTP pool, so the ordinary calls get all six connections
 * back.
 *
 * Shared by the server (it refuses any other procedure on the socket) and the
 * web client (it routes these and only these to the socket). Pure data: the web
 * bundle imports it at runtime.
 */

/**
 * Subscriptions: long-lived, read-only, and resumable. A tab that releases its
 * socket while hidden can drop any of them and reopen it later without losing
 * anything it cannot get back (the event streams resync, log tails reattach).
 */
export const LIVE_SOCKET_PROCEDURES = [
  "docker.events.stream",
  "edgeLogs.events.tail",
  "edgeLogs.tail",
  "events.orgStream",
  "events.stream",
  "project.events.stream",
  "project.logs.tail",
  "project.resource.deployments.buildLogs.stream",
  "project.resource.deployments.logs.tail",
  "project.resource.logs.tail",
  "project.resource.taskLogs.tail",
  "server.provisionLogs",
  "system.progress",
] as const;

/**
 * Streams that stay on plain HTTP: the stream IS the operation (it creates
 * something and reports progress), so it must live exactly as long as the
 * request that started it. Releasing a hidden tab's socket would abort it
 * halfway through.
 */
export const REQUEST_BOUND_STREAMS = ["project.resource.database.postgres.create"] as const;

/** The RPC prefix the socket's requests carry, the same one plain HTTP uses. */
export const LIVE_SOCKET_RPC_PREFIX = "/rpc";

/** Path the socket upgrades on. Not under `/rpc`, which is the HTTP handler's. */
export const LIVE_SOCKET_PATH = "/live/rpc";

const liveProcedures: ReadonlySet<string> = new Set(LIVE_SOCKET_PROCEDURES);

/** Whether the procedure at `path` (`["events", "orgStream"]`) rides the socket. */
export function isLiveSocketProcedure(path: readonly string[]): boolean {
  return liveProcedures.has(path.join("."));
}

/** Whether an RPC request URL path (`/rpc/events/orgStream`) names one. */
export function isLiveSocketPathname(pathname: string): boolean {
  const prefix = `${LIVE_SOCKET_RPC_PREFIX}/`;
  if (!pathname.startsWith(prefix)) return false;
  return isLiveSocketProcedure(pathname.slice(prefix.length).split("/"));
}
