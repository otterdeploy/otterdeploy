import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";

import type { CloneResult, GitRepoConfig } from "./types";

const log = createLogger("pipeline:clone");

export interface CloneSourceDeps {
  cloneRepository: (opts: {
    owner: string;
    name: string;
    branch: string;
    commitSha?: string;
    targetDir: string;
    accessToken?: string;
    rootDirectory?: string;
  }) => Promise<Result<{ path: string }, Error>>;
}

/**
 * Step 2: Clone source code.
 * - If buildMethod is docker_image, skip cloning (image is already available).
 * - Otherwise clone the git repository to /tmp/otterstack-builds/{deploymentId}/
 * - Apply rootDirectory if configured.
 *
 * Idempotent: if the target directory already exists from a previous attempt,
 * re-cloning will overwrite it via the git clone command.
 */
export async function cloneSource(
  input: {
    deploymentId: string;
    buildMethod: string;
    gitRepo: GitRepoConfig | null;
    gitCommitSha?: string;
  },
  deps: CloneSourceDeps,
): Promise<Result<CloneResult, Error>> {
  try {
    // Skip clone for docker_image builds — the image reference is used directly
    if (input.buildMethod === "docker_image") {
      log.info({ deploymentId: input.deploymentId }, "Skipping clone for docker_image build");
      return Result.ok({ sourceDir: "", skipped: true });
    }

    if (!input.gitRepo) {
      return Result.err(
        new Error(`No git repository configured for deployment ${input.deploymentId}`),
      );
    }

    const targetDir = `/tmp/otterstack-builds/${input.deploymentId}`;

    const cloneResult = await deps.cloneRepository({
      owner: input.gitRepo.owner,
      name: input.gitRepo.name,
      branch: input.gitRepo.branch,
      commitSha: input.gitCommitSha,
      targetDir,
      accessToken: input.gitRepo.accessToken,
      rootDirectory: input.gitRepo.rootDirectory ?? undefined,
    });

    if (cloneResult.isErr()) {
      return Result.err(cloneResult.error);
    }

    const sourceDir = cloneResult.value.path;
    log.info({ deploymentId: input.deploymentId, sourceDir }, "Source cloned");

    return Result.ok({ sourceDir, skipped: false });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, deploymentId: input.deploymentId }, "Clone failed");
    return Result.err(err);
  }
}
