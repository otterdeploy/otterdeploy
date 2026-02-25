import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";
import { join } from "node:path";
import { stat, writeFile, access } from "node:fs/promises";

const log = createLogger("builder:context");

const DEFAULT_DOCKERIGNORE = `.git
node_modules
.env
.env.*
`;

export async function prepareBuildContext(
  sourceDir: string,
  rootDirectory?: string,
): Promise<Result<string, Error>> {
  try {
    let effectivePath = sourceDir;

    // If rootDirectory is set, resolve the subdirectory
    if (rootDirectory) {
      effectivePath = join(sourceDir, rootDirectory);
      const dirStat = await stat(effectivePath);

      if (!dirStat.isDirectory()) {
        return Result.err(
          new Error(`Root directory is not a directory: ${rootDirectory}`),
        );
      }

      log.info({ rootDirectory, effectivePath }, "Using subdirectory as build context");
    }

    // Inject default .dockerignore if not present
    const dockerignorePath = join(effectivePath, ".dockerignore");
    try {
      await access(dockerignorePath);
      log.debug({ path: dockerignorePath }, ".dockerignore already exists, skipping injection");
    } catch {
      await writeFile(dockerignorePath, DEFAULT_DOCKERIGNORE, "utf-8");
      log.info({ path: dockerignorePath }, "Injected default .dockerignore");
    }

    return Result.ok(effectivePath);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, sourceDir, rootDirectory }, "Failed to prepare build context");
    return Result.err(err);
  }
}
