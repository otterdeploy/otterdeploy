import type { ServerId } from "@otterdeploy/shared/id";

import type { SshKeyRecord, SshKeyServerRow } from "./queries";

/** A server that signs in with the key. Derived from `server.ssh_key_id` at
 *  read time, never stored on the key. */
export interface SshKeyServerUsage {
  kind: "server";
  serverId: ServerId;
  name: string;
  role: "manager" | "worker";
}

export type SshKeyView = SshKeyRecord & { usedBy: SshKeyServerUsage[] };

export const toUsage = (row: SshKeyServerRow): SshKeyServerUsage => ({
  kind: "server",
  serverId: row.serverId,
  name: row.name,
  role: row.role,
});
