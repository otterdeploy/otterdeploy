/**
 * How a server is named and addressed on screen, and how its workload is
 * counted. Pure, so the review-box findings stay fixed:
 *
 *   - The control plane's bootstrap row is registered as `localhost` at
 *     `127.0.0.1`: how the control plane reaches itself, not what the machine
 *     is called or where anyone else can reach it. It is named by the
 *     hostname the host reports, and addressed by the install's public IP
 *     (`address`, resolved by `server.list`).
 *   - "Tasks" are Swarm's scheduling units. On plain Docker the same number
 *     counts the platform's running containers, and says so.
 */
import { isControlPlaneRow } from "./server-state";

interface NamedServer {
  name: string;
  hostname: string | null;
  host: string;
  role: "manager" | "worker";
  labels: string[];
  address?: string | null;
}

export function serverDisplayName(server: NamedServer): string {
  if (isControlPlaneRow(server) && server.hostname) return server.hostname;
  return server.name;
}

const LOOPBACK = "127.0.0.1";

export function serverDisplayAddress(server: NamedServer): string {
  if (server.address) return server.address;
  if (server.host === LOOPBACK) return "unknown";
  return server.host;
}

export function workloadCount(count: number, isSwarm: boolean): string {
  const noun = isSwarm ? "task" : "container";
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
