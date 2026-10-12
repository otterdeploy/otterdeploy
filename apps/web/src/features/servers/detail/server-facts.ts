/**
 * How a server is named and addressed on screen, and how its workload is
 * counted. Pure, so the review-box findings stay fixed:
 *
 *   - The control plane's bootstrap row is registered as `localhost` at
 *     `127.0.0.1`: how the control plane reaches itself, not what the machine
 *     is called or where anyone else can reach it. It is named by the
 *     hostname the host reports, and addressed by the install's public IP
 *     (`address`, resolved by `server.list` for installation admins only;
 *     everyone else gets `addressHidden`).
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
  addressHidden?: boolean;
}

export function serverDisplayName(server: NamedServer): string {
  if (isControlPlaneRow(server) && server.hostname) return server.hostname;
  return server.name;
}

const LOOPBACK = "127.0.0.1";

/** Where the machine is, as this viewer may see it. */
type ServerAddressView =
  | { kind: "known"; address: string }
  /** The control plane has a public IP the server sends to installation
   *  admins only. */
  | { kind: "hidden" }
  | { kind: "unknown" };

export function serverAddressView(server: NamedServer): ServerAddressView {
  if (server.address) return { kind: "known", address: server.address };
  if (server.addressHidden) return { kind: "hidden" };
  if (server.host === LOOPBACK) return { kind: "unknown" };
  return { kind: "known", address: server.host };
}

export function workloadCount(count: number, isSwarm: boolean): string {
  const noun = isSwarm ? "task" : "container";
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
