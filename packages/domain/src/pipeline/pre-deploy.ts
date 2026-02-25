import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";

const log = createLogger("pipeline:pre-deploy");

export interface PreDeployDeps {
  /**
   * Create a temporary container, run a command, wait for exit, remove container.
   */
  runOneOffContainer: (input: {
    image: string;
    command: string[];
    env: string[];
    timeoutMs?: number;
  }) => Promise<Result<{ exitCode: number; output: string }, Error>>;
}

/**
 * Step 5: Run pre-deploy command.
 * - If no preDeployCommand is configured, this step is a no-op.
 * - Creates a temporary container with the built image.
 * - Runs the command and waits for exit code 0.
 * - Fails the pipeline if the command exits non-zero.
 *
 * Idempotent: running the command again is safe (e.g., database migrations are typically idempotent).
 */
export async function runPreDeployCommand(
  input: {
    deploymentId: string;
    preDeployCommand: string | null;
    fullImage: string;
    runtimeEnv: Record<string, string>;
  },
  deps: PreDeployDeps,
): Promise<Result<void, Error>> {
  try {
    if (!input.preDeployCommand) {
      log.info({ deploymentId: input.deploymentId }, "No pre-deploy command configured, skipping");
      return Result.ok(undefined);
    }

    log.info(
      { deploymentId: input.deploymentId, command: input.preDeployCommand },
      "Running pre-deploy command",
    );

    // Convert runtime env to KEY=VALUE format for Docker
    const envArray = Object.entries(input.runtimeEnv).map(([k, v]) => `${k}=${v}`);

    // Parse command string into array (split on whitespace, respecting basic quoting)
    const command = parseCommand(input.preDeployCommand);

    const result = await deps.runOneOffContainer({
      image: input.fullImage,
      command,
      env: envArray,
      timeoutMs: 300_000, // 5 minute timeout for pre-deploy commands
    });

    if (result.isErr()) {
      return Result.err(result.error);
    }

    const { exitCode, output } = result.value;

    if (exitCode !== 0) {
      return Result.err(
        new Error(
          `Pre-deploy command exited with code ${exitCode}: ${output.slice(0, 500)}`,
        ),
      );
    }

    log.info({ deploymentId: input.deploymentId }, "Pre-deploy command completed successfully");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, deploymentId: input.deploymentId }, "Pre-deploy command failed");
    return Result.err(err);
  }
}

/**
 * Parse a shell command string into an array of arguments.
 * Handles basic quoting with single and double quotes.
 */
function parseCommand(cmd: string): string[] {
  const args: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (const char of cmd) {
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === " " && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args.length > 0 ? args : ["sh", "-c", cmd];
}
