/**
 * The words the SSH keys page uses for a key's servers, kept pure so they can
 * be tested without the live collections: what Rotate will touch, why Delete
 * is held, and which servers are down.
 */
import { listNames, plural } from "./ssh-keys";

interface NamedServer {
  name: string;
  state: { tone: "good" | "warn" | "bad" | "muted" | "accent" } | null;
}

/** A server whose state says it won't answer right now. Rotation still runs
 *  (and stops without changing anything if a server can't take the new key),
 *  but the operator should know before they start. */
export function isUnreachable(server: NamedServer): boolean {
  return server.state?.tone === "bad";
}

export function rotateTooltip(servers: NamedServer[]): string {
  const down = servers.filter(isUnreachable);
  if (down.length > 0) {
    return `${listNames(down.map((s) => s.name))} ${down.length === 1 ? "is" : "are"} down; rotation stops unless every server takes the new key`;
  }
  if (servers.length > 0) return `Re-authorizes on ${plural(servers.length, "server")}`;
  return "Replace the keypair";
}

export function deleteTooltip(servers: NamedServer[]): string {
  return servers.length > 0 ? `In use by ${listNames(servers.map((s) => s.name))}` : "Delete key";
}
