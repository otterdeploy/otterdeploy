import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";

const log = createLogger("git:clone");

export interface CloneRepositoryOpts {
  owner: string;
  name: string;
  branch: string;
  commitSha?: string;
  targetDir: string;
  accessToken?: string; // for private repos
  rootDirectory?: string;
}

/**
 * Execute a shell command via child_process spawn and return stdout.
 */
function execCommand(
  command: string,
  args: string[],
): Promise<Result<string, Error>> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      resolve(Result.err(err));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(Result.ok(stdout.trim()));
      } else {
        resolve(
          Result.err(
            new Error(
              `Command "${command} ${args.join(" ")}" exited with code ${code}: ${stderr.trim()}`,
            ),
          ),
        );
      }
    });
  });
}

/**
 * Build the clone URL for a GitHub repository.
 */
export function buildCloneUrl(
  owner: string,
  name: string,
  accessToken?: string,
): string {
  if (accessToken) {
    return `https://x-access-token:${accessToken}@github.com/${owner}/${name}.git`;
  }
  return `https://github.com/${owner}/${name}.git`;
}

/**
 * Clone a repository to a target directory.
 */
export async function cloneRepository(
  opts: CloneRepositoryOpts,
): Promise<Result<{ path: string }, Error>> {
  const { owner, name, branch, commitSha, targetDir, accessToken, rootDirectory } = opts;
  const url = buildCloneUrl(owner, name, accessToken);

  log.info({ owner, name, branch }, "cloning repository");

  const cloneArgs = [
    "clone",
    "--depth",
    "1",
    "--single-branch",
    "--branch",
    branch,
    url,
    targetDir,
  ];

  const cloneResult = await execCommand("git", cloneArgs);
  if (cloneResult.isErr()) return cloneResult as Result<never, Error>;

  // If a specific commit SHA is requested, fetch and checkout
  if (commitSha) {
    log.info({ sha: commitSha }, "checking out specific commit");

    const fetchResult = await execCommand("git", [
      "-C",
      targetDir,
      "fetch",
      "--depth",
      "1",
      "origin",
      commitSha,
    ]);
    if (fetchResult.isErr()) return fetchResult as Result<never, Error>;

    const checkoutResult = await execCommand("git", [
      "-C",
      targetDir,
      "checkout",
      commitSha,
    ]);
    if (checkoutResult.isErr()) return checkoutResult as Result<never, Error>;
  }

  // Resolve root directory if specified
  if (rootDirectory) {
    const subDir = join(targetDir, rootDirectory);
    try {
      const stats = await stat(subDir);
      if (!stats.isDirectory()) {
        return Result.err(
          new Error(
            `Root directory "${rootDirectory}" exists but is not a directory`,
          ),
        );
      }
      return Result.ok({ path: subDir });
    } catch {
      return Result.err(
        new Error(
          `Root directory "${rootDirectory}" not found in repository ${owner}/${name}`,
        ),
      );
    }
  }

  return Result.ok({ path: targetDir });
}
