/**
 * `${{vault.<provider>.otterdeploy/<field>}}` — the provider CONNECTION's own
 * credentials, rather than a secret stored inside it.
 *
 * The bootstrap chicken-and-egg this exists for: an app that authenticates to
 * the secret manager ITSELF at boot (varlock, the Infisical agent, `vault
 * agent`) needs the Universal Auth pair or the service token in its
 * environment. That credential cannot come out of the vault, because it is the
 * thing that opens the vault. Before this, the only way to give it to a
 * container was to paste the client id and secret back in by hand — re-typing
 * a credential otterdeploy already stores, and creating a second copy that
 * rotation would miss (od-lvtx).
 *
 * THIS IS A DELIBERATE WIDENING OF WHAT THE CREDENTIAL IS FOR. Everywhere else
 * `vault_provider.credentialCiphertext` is read only to call the provider's
 * own API, and the schema note is emphatic that it never leaves the server.
 * A connection ref hands it to a tenant container instead, so it must stay
 * opt-in and explicit: the operator writes the reference, nothing resolves one
 * implicitly, and no read/output schema ever gains these fields. Resolution
 * happens only on the deploy path, exactly like any other vault value.
 *
 * The `otterdeploy/` prefix is RESERVED. It is a legal `ref` under the parser
 * grammar (`[A-Za-z0-9_\-./:]+`), so no parser change was needed, and a real
 * secret under that path is shadowed rather than fetched. That is the one
 * trade here: it is documented, and the prefix was chosen to make an accidental
 * collision implausible.
 */

import type { VaultProviderConfig } from "@otterdeploy/db/schema";

/** Every connection ref starts with this. Not configurable: it is the whole
 *  basis for telling a connection field apart from a secret name. */
export const CONNECTION_REF_PREFIX = "otterdeploy/";

/** The provider row's fields this resolves from. Deliberately the narrow
 *  subset it needs, so a caller cannot pass a whole row by accident and have
 *  an unrelated column become referenceable later. */
export interface ConnectionSource {
  kind: "hashicorp" | "infisical" | "doppler";
  config: VaultProviderConfig;
  /** The already-decrypted secret half. Decryption stays with the caller: this
   *  module is pure so the field table is testable without crypto or a DB. */
  credential: string;
}

/**
 * Field name → what it reads. `null` means "the secret half", whatever this
 * provider calls it.
 *
 * Names are snake_case renderings of the config keys rather than the camelCase
 * the column happens to store, because the value's destination is an
 * environment variable and the operator is reading this in a variables table,
 * not in TypeScript.
 */
const COMMON_FIELDS: Record<string, keyof VaultProviderConfig | null> = {
  credential: null,
};

const FIELDS_BY_KIND: Record<
  ConnectionSource["kind"],
  Record<string, keyof VaultProviderConfig | null>
> = {
  infisical: {
    // Universal Auth. `client_secret` is the same value as `credential`, named
    // for what Infisical calls it, since that is what the operator is looking
    // for when they come here.
    client_secret: null,
    client_id: "clientId",
    site_url: "siteUrl",
    project_id: "projectId",
    environment_slug: "environmentSlug",
    secret_path: "secretPath",
  },
  hashicorp: {
    token: null,
    url: "url",
    mount: "mount",
    namespace: "namespace",
  },
  doppler: {
    token: null,
    project: "dopplerProject",
    config: "dopplerConfig",
  },
};

/** True when this ref addresses the connection rather than a stored secret. */
export function isConnectionRef(ref: string): boolean {
  return ref.startsWith(CONNECTION_REF_PREFIX);
}

/** The field part, i.e. what follows the reserved prefix. */
function fieldOf(ref: string): string {
  return ref.slice(CONNECTION_REF_PREFIX.length);
}

/** Every field this provider kind accepts, sorted, for error messages. */
export function connectionFieldsFor(kind: ConnectionSource["kind"]): string[] {
  return [...Object.keys(COMMON_FIELDS), ...Object.keys(FIELDS_BY_KIND[kind])].sort();
}

export type ConnectionRefResult = { ok: true; value: string } | { ok: false; detail: string };

/**
 * Resolve one connection ref against a provider row.
 *
 * Fails rather than returning an empty string for an unset optional field: a
 * blank credential silently injected into a container's environment is the
 * failure mode this whole path exists to avoid, and an unset `namespace` means
 * the operator referenced something they never configured.
 */
export function resolveConnectionRef(source: ConnectionSource, ref: string): ConnectionRefResult {
  const field = fieldOf(ref);
  const table = { ...COMMON_FIELDS, ...FIELDS_BY_KIND[source.kind] };

  if (!(field in table)) {
    const known = connectionFieldsFor(source.kind)
      .map((f) => `${CONNECTION_REF_PREFIX}${f}`)
      .join(", ");
    return {
      ok: false,
      detail:
        `"${ref}" is not a connection field for a ${source.kind} provider. ` +
        `The ${CONNECTION_REF_PREFIX} prefix is reserved for the connection's own ` +
        `credentials; available here: ${known}`,
    };
  }

  const configKey = table[field];
  if (configKey == null) {
    // The secret half is NOT NULL on the row, so an empty one means the
    // ciphertext decrypted to nothing: report it rather than exporting "".
    if (source.credential === "") {
      return { ok: false, detail: "the stored credential for this provider is empty" };
    }
    return { ok: true, value: source.credential };
  }

  const value = source.config[configKey];
  if (value === undefined || value === "") {
    return {
      ok: false,
      detail: `this provider has no ${field} configured`,
    };
  }
  return { ok: true, value };
}
