/**
 * Where a server can be reached, for display.
 *
 * Every organization's bootstrap row for the control plane is registered as
 * `127.0.0.1`: that is how the control plane reaches itself (its local PTY,
 * its own Docker socket), and it is the key the local health sampler matches
 * on, so the row keeps it. It is not an address anyone else can use, and the
 * server page showed it as the machine's Host. The install's public IP is.
 *
 * That IP is the install's, not the organization's, and it is for
 * installation admins only (the rule Settings → Domains follows for the same
 * address). Everyone else gets the row with no address and `addressHidden`,
 * so the page can say an address exists without showing it. A server an
 * organization registered itself keeps its own host for every member: they
 * add, retry and remove those.
 */
const LOOPBACK = "127.0.0.1";

export interface ServerAddress {
  address: string | null;
  /** An address exists, but this caller may not see it. */
  addressHidden: boolean;
}

export function serverAddress(
  row: { host: string },
  publicIp: string | null,
  opts: { reveal: boolean },
): ServerAddress {
  if (row.host !== LOOPBACK) return { address: row.host, addressHidden: false };
  if (publicIp === null) return { address: null, addressHidden: false };
  if (opts.reveal) return { address: publicIp, addressHidden: false };
  return { address: null, addressHidden: true };
}
