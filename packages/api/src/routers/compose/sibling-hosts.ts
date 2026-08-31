/**
 * Point a stack's own env values at the sibling they meant.
 *
 * A compose file addresses its peers by bare service key — `db`, `redis`,
 * `server` — because that is what compose guarantees on the file's own
 * network. Here the project network is SHARED by every stack, and
 * `service_resource` enforces UNIQUE (network_name, internal_hostname), so the
 * second stack to declare a `db` gets renamed to `<stack>-db`
 * (`pickInternalHostname`). Its env still said `db`.
 *
 * On a shared network that name still RESOLVES — to whoever got there first.
 * So `autumn` dialled `authentik`'s postgres and crash-looped on "password
 * authentication failed for user autumn", and its REDIS_URL quietly pointed at
 * authentik's redis: cross-stack data bleed, not a connection error (od-tahh).
 *
 * This rewrites those references through the rename map once every child's row
 * exists. The proper fix is a per-stack network carrying the bare names as
 * aliases, which is compose's own semantics; this is the contained half, and
 * it is what stops one stack reading another's data.
 *
 * WHAT IT WILL NOT TOUCH, because a bare compose key is also an ordinary word:
 * `POSTGRES_DB=db` is a database name, not a host, and rewriting it to
 * `autumn-db` would break the very service this exists to fix. So a bare value
 * is only rewritten when the KEY says it holds a host. Everything else has to
 * carry positional proof — a scheme, or a port.
 */

/** compose service key → the hostname its row actually got. Only entries where
 *  the two differ are worth carrying. */
export type SiblingRenames = ReadonlyMap<string, string>;

/** Keys whose value is a host and nothing else. Anchored on a word boundary so
 *  `POSTGRES_DB` never matches while `DB_HOST` and `HOST` both do. */
const HOST_KEY = /(^|_)(HOST|HOSTNAME|SERVER|ADDR|ADDRESS)$/;

/** `scheme://[user[:pass]@]host[:port][rest]`. The host is captured on its own
 *  so a path containing the name is left alone. The userinfo group is greedy
 *  up to the LAST `@` before the path, because a generated password routinely
 *  contains one — matching to the first `@` read `p@ss` as the host. */
const URL_AUTHORITY = /^([a-z][a-z0-9+.-]*:\/\/)(?:([^/]*)@)?([^/:?#]+)(.*)$/i;

/** `host:port`, no scheme. The port is the positional proof that the left side
 *  is a host. */
const HOST_PORT = /^([^\s:/@]+):(\d+)$/;

/** One value, one rename map. Returns the value unchanged when nothing in it
 *  is provably a reference to a renamed sibling. */
function rewriteOne(key: string, value: string, renames: SiblingRenames): string {
  const url = URL_AUTHORITY.exec(value);
  if (url) {
    const [, scheme = "", userinfo, host = "", rest = ""] = url;
    const renamed = renames.get(host);
    if (renamed === undefined) return value;
    return `${scheme}${userinfo === undefined ? "" : `${userinfo}@`}${renamed}${rest}`;
  }

  const hostPort = HOST_PORT.exec(value);
  if (hostPort) {
    const [, host = "", port = ""] = hostPort;
    const renamed = renames.get(host);
    return renamed === undefined ? value : `${renamed}:${port}`;
  }

  // Bare host, and only where the key vouches for it.
  if (HOST_KEY.test(key.toUpperCase())) {
    return renames.get(value) ?? value;
  }
  return value;
}

/**
 * Rewrite every sibling reference in one env value.
 *
 * Comma-separated lists are handled part-by-part (cluster seed lists are
 * written that way), preserving the original spacing around each separator so
 * a rewrite is a substitution and not a reformat.
 */
export function rewriteSiblingHosts(key: string, value: string, renames: SiblingRenames): string {
  if (renames.size === 0 || value.length === 0) return value;
  return value
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      if (trimmed.length === 0) return part;
      const next = rewriteOne(key, trimmed, renames);
      // Substitute in place so the part's original padding survives.
      return next === trimmed ? part : part.replace(trimmed, next);
    })
    .join(",");
}

/**
 * The renames worth applying: compose key → actual hostname, for children
 * whose hostname is NOT their bare compose key. A child that kept its bare
 * name needs no entry, and including it would make every rewrite a no-op that
 * still counted as a change.
 */
export function siblingRenames(
  children: ReadonlyArray<{ composeService: string; internalHostname: string }>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const child of children) {
    if (child.composeService !== child.internalHostname) {
      out.set(child.composeService, child.internalHostname);
    }
  }
  return out;
}
