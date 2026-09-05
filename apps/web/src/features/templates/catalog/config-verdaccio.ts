// The config.yaml the verdaccio template ships. Its own module because
// templates-devkit.ts is capped at 250 lines and this file is 91 of them.

/**
 * Shipped in place of the image's own seed file.
 *
 * Verdaccio reads almost nothing from the environment (see
 * env-schemas/verdaccio.env.schema); config.yaml IS the configuration surface,
 * and there is no `${ENV}` interpolation in it at 6.10.2 either —
 * @verdaccio/config's `parseConfigFile` is a bare `js-yaml.load`. So a
 * template that wants to change any default has to ship the file.
 *
 * This is upstream's docker.yaml with the comment walls trimmed and exactly
 * two behavioural changes, both marked below. No `interpolate` flag: the file
 * holds no per-install secret, so it carries no `${VAR}` refs and needs no
 * prompt. Verdaccio generates and persists its own signing secret in
 * .verdaccio-db.json on the storage volume.
 */
export const VERDACCIO_CONFIG = `# Verdaccio 6.10.2 configuration, shipped by the otterdeploy template.
#
# Derived from @verdaccio/config's docker.yaml (the file the image would seed
# if this one were absent), with two changes: self-registration is closed and
# anonymous access is removed. Everything else - storage paths, the npmjs
# uplink, the audit middleware, logging - is upstream's.
# Reference: https://verdaccio.org/docs/configuration

# Both paths sit under the verdaccio-storage volume / the image's own tree.
storage: /verdaccio/storage/data
plugins: /verdaccio/plugins

web:
  title: Verdaccio

# https://verdaccio.org/docs/plugin-auth
auth:
  htpasswd:
    file: /verdaccio/storage/htpasswd
    # CHANGE 1 of 2, and the reason this file exists. Upstream omits max_users,
    # which defaults to Infinity: any stranger who can reach the port runs
    # \`npm adduser\`, becomes $authenticated, and inherits publish AND unpublish
    # on every package pattern below. A negative value makes
    # PUT /-/user/... answer 409 "user registration disabled".
    #
    # The trade-off, verified rather than assumed: this closes \`npm adduser\`
    # for EVERYONE, including existing users, because the endpoint only takes
    # its login branch when the request already carries credentials. Create
    # the first account by appending to the htpasswd file on the storage
    # volume (openssl ships in the image; Verdaccio re-reads the file per
    # request, so no restart):
    #
    #   docker compose exec verdaccio sh -c \\
    #     'echo "alice:$(openssl passwd -apr1 CHOOSE_A_PASSWORD)" >> /verdaccio/storage/htpasswd'
    #
    # Then authenticate from the client with basic auth rather than npm login:
    #
    #   npm config set //REGISTRY_HOST/:_auth "$(printf 'alice:PASSWORD' | base64)"
    #
    # bcrypt, {SHA}, apr1 and crypt(3) hashes are all accepted.
    #
    # UPGRADING AN INSTANCE THAT WAS ALREADY EXPOSED: this closes new
    # registrations, it does not revoke old ones. Accounts created while the
    # permissive default was live survive in /verdaccio/storage/htpasswd and
    # keep working. Read that file and delete what you do not recognise.
    max_users: -1

# https://verdaccio.org/docs/uplinks
uplinks:
  npmjs:
    url: https://registry.npmjs.org/

# https://verdaccio.org/docs/packages
# CHANGE 2 of 2. Upstream ships \`access: $all\` on both patterns, i.e. anonymous
# clients may install anything this registry holds and pull anything through
# the uplink. $authenticated makes an open mirror a decision instead of a
# default; relax a pattern back to $all deliberately if that is what you want.
#
# \`proxy: npmjs\` stays on BOTH patterns on purpose. '@*/*' matches every scoped
# package, not only yours, so dropping the proxy there would break @types/* and
# every other public scoped dependency. To defend against dependency confusion,
# add a pattern for your own scope ABOVE these two, with no proxy line.
packages:
  '@*/*':
    access: $authenticated
    publish: $authenticated
    unpublish: $authenticated
    proxy: npmjs

  '**':
    access: $authenticated
    publish: $authenticated
    unpublish: $authenticated
    proxy: npmjs

# https://verdaccio.org/docs/configuration
server:
  keepAliveTimeout: 60

middlewares:
  audit:
    enabled: true

log:
  type: stdout
  format: pretty
  level: http

i18n:
  web: en-US
`;
