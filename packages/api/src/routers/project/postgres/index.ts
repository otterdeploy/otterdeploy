/**
 * Public surface for the postgres resource lifecycle.
 *
 * Implementation is split across files in this folder:
 *   - create-stream.ts:  streaming create generator + pre-flight validation
 *   - env.ts:            public-toggle, extraEnv writers, rollback
 *   - boot-logs.ts:      container boot-log tail used during create
 *   - snapshot.ts:       PostgresSnapshotV1 + factory used by deployments
 *
 * Importers should always use `./postgres` (this barrel) so the file
 * layout can keep evolving without touching call sites.
 */

export {
  createPostgresResourceStream,
  validatePostgresCreate,
  type CreatePostgresProgress,
} from "./create-stream";

export {
  applyPostgresExtraEnv,
  rollbackPostgresToSnapshot,
  setPostgresExtraEnvKey,
  setPostgresPublic,
  unsetPostgresExtraEnvKey,
} from "./env";

export {
  snapshotForPostgresCreate,
  type PostgresSnapshotV1,
} from "./snapshot";
