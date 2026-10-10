import { useLiveQuery } from "@tanstack/react-db";

import type { ServerState } from "@/features/servers/detail/server-state";

import { serverHealthCollection } from "@/features/servers/data/health";
import { serverCollection } from "@/features/servers/data/server";
import { deriveServerState } from "@/features/servers/detail/server-state";

import type { SshKeyUsage } from "./ssh-keys";

/** A server that signs in with a key, with the same state the Servers page
 *  shows for it (one derivation, so a chip can't disagree with that page). */
export interface KeyServer extends SshKeyUsage {
  /** Null while the server list hasn't loaded, or for a server it doesn't hold. */
  state: ServerState | null;
}

/** Resolve every key's `usedBy` against the live server + health collections. */
export function useKeyServers(): (usedBy: SshKeyUsage[]) => KeyServer[] {
  const { data: servers = [] } = useLiveQuery(() => serverCollection);
  const { data: health = [] } = useLiveQuery(() => serverHealthCollection);
  const byId = new Map(servers.map((s) => [s.id, s]));
  const healthById = new Map(health.map((h) => [h.serverId, h]));
  return (usedBy) =>
    usedBy.map((u) => {
      const server = byId.get(u.serverId);
      return {
        ...u,
        state: server ? deriveServerState(server, healthById.get(u.serverId) ?? null) : null,
      };
    });
}
