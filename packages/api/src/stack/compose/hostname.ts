/**
 * The DNS names a compose stack child answers to.
 *
 * A compose file addresses its peers by service KEY, and compose guarantees
 * that key resolves on the stack's network. The platform stores a child's
 * hostname as a DNS label (lowercase, `[a-z0-9-]`), so a key that is not one
 * already (`plausible_db`) was stored as `plausible-db` and the key itself
 * resolved to nothing. Env the file sets is repointed (see
 * routers/compose/sibling-hosts.ts), but an app's BUILT-IN default is not
 * env: Plausible dials `plausible_db:5432` and `plausible_events_db:8123` from
 * its own runtime config, and crash-looped on nxdomain.
 */

/** A compose service key as the DNS label stored for its child's hostname. */
export function createComposeHostLabel(composeKey: string): string {
  return composeKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** What Docker accepts as a network alias, kept to one label: no dots, so an
 *  alias can never shadow a name under a real domain. */
const COMPOSE_KEY_ALIAS = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/**
 * The compose key as an extra network alias, when storing the child's
 * hostname had to change it. Null when the hostname already IS the key (DNS is
 * case-insensitive, so case alone needs nothing).
 *
 * Only for a child that holds its key's own label. A child whose bare label
 * was taken by another stack was renamed (`<stack>-<key>`, see
 * pickInternalHostname); the key is then the other stack's, which already
 * answers to it, and a second owner of one alias would round-robin traffic
 * between two stacks.
 */
export function resolveComposeKeyAlias(
  composeKey: string | null,
  internalHostname: string,
): string | null {
  if (composeKey === null) return null;
  const alias = composeKey.toLowerCase();
  if (alias === internalHostname) return null;
  if (createComposeHostLabel(composeKey) !== internalHostname) return null;
  return COMPOSE_KEY_ALIAS.test(alias) ? alias : null;
}
