/**
 * The service's build variables as files, for `buildx --secret id=K,src=FILE`.
 *
 * Why files and not `env=K`: an `env=` secret is read from the docker CLI's
 * own process env, so every service variable would also become configuration
 * for that CLI. The helper's docker client holds the host's docker socket, and
 * `DOCKER_CONFIG` / `DOCKER_HOST` / `BUILDX_CONFIG` are exactly the kind of
 * names a service could set. A file mount hands BuildKit the same value and
 * leaves the CLI's env alone (railpack-env.ts has the full picture).
 *
 * The files live in a fresh 0700 temp dir (0600 each), outside the build
 * context so they can never be COPYed into an image, and are removed as soon
 * as the build finishes, pass or fail.
 */

import { Result } from "better-result";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SecretFiles {
  /** Variable name → file holding its value. */
  paths: Record<string, string>;
  /** Delete the files. Best-effort: the helper's `--rm` reclaims them anyway. */
  remove: () => Promise<void>;
}

const NO_SECRET_FILES: SecretFiles = { paths: {}, remove: () => Promise.resolve() };

export async function createSecretFiles(env: Record<string, string>): Promise<SecretFiles> {
  const entries = Object.entries(env);
  if (entries.length === 0) return NO_SECRET_FILES;

  const dir = await mkdtemp(join(tmpdir(), "otter-build-secrets-"));
  const paths: Record<string, string> = {};
  for (const [name, value] of entries) {
    // Names are env identifiers (railpack-env.ts ENV_NAME), safe as filenames.
    const path = join(dir, name);
    await writeFile(path, value, { mode: 0o600 });
    paths[name] = path;
  }
  return {
    paths,
    remove: async () => {
      await Result.tryPromise(() => rm(dir, { recursive: true, force: true }));
    },
  };
}
