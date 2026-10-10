/**
 * Where a server can be reached, for display.
 *
 * Every organization's bootstrap row for the control plane is registered as
 * `127.0.0.1`: that is how the control plane reaches itself (its local PTY,
 * its own Docker socket), and it is the key the local health sampler matches
 * on, so the row keeps it. It is not an address anyone else can use, and the
 * server page showed it as the machine's Host. The install's public IP is.
 */
const LOOPBACK = "127.0.0.1";

export function serverAddress(row: { host: string }, publicIp: string | null): string | null {
  if (row.host === LOOPBACK) return publicIp;
  return row.host;
}
