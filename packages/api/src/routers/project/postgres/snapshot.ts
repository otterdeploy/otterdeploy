/**
 * Deployment snapshot for postgres resources.
 *
 * Captures the fields that fully reproduce a postgres deploy. Schema is
 * intentionally flat + json-serializable so a future rollback handler can
 * read it back, write the fields onto the resource row, and trigger a
 * normal redeploy without having to re-derive anything.
 *
 * `kind` is the discriminator — the resource detail handler reads it to
 * know which snapshot reader to apply (postgres vs service vs future
 * engines). Bump the version any time the shape changes incompatibly so
 * old snapshots can be migrated or refused with a clear error.
 */

export interface PostgresSnapshotV1 {
  kind: "postgres";
  version: 1;
  image: string;
  databaseName: string;
  username: string;
  password: string;
  publicEnabled: boolean;
  publicHostname: string;
  internalHostname: string;
  extraEnv: Record<string, string>;
}

export function snapshotForPostgresCreate(input: {
  image: string;
  databaseName: string;
  username: string;
  password: string;
  publicEnabled: boolean;
  publicHostname: string;
  internalHostname: string;
  extraEnv: Record<string, string>;
}): Record<string, unknown> {
  const snap: PostgresSnapshotV1 = {
    kind: "postgres",
    version: 1,
    image: input.image,
    databaseName: input.databaseName,
    username: input.username,
    password: input.password,
    publicEnabled: input.publicEnabled,
    publicHostname: input.publicHostname,
    internalHostname: input.internalHostname,
    extraEnv: input.extraEnv,
  };
  return snap as unknown as Record<string, unknown>;
}
