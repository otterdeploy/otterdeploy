import { Result } from "better-result";
import { execSync, spawn } from "node:child_process";
import { writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createLogger } from "@otterdeploy/logger";

const log = createLogger("docker:stack");

const STACK_TMP_DIR = join(tmpdir(), "otterstack-stacks");

export interface StackServiceInfo {
  name: string;
  replicas: string;
  image: string;
}

type StackCommandStream = "stdout" | "stderr";

function flushChunkLines(
  chunk: string,
  remainder: string,
  onLine?: (line: string) => void,
): string {
  const combined = `${remainder}${chunk}`;
  const parts = combined.split(/\r?\n/);
  const nextRemainder = parts.pop() ?? "";
  for (const line of parts) {
    if (line.trim().length === 0) continue;
    onLine?.(line);
  }
  return nextRemainder;
}

async function runDockerCommand(
  args: string[],
  options?: {
    timeoutMs?: number;
    onLogLine?: (line: string, stream: StackCommandStream) => void;
  },
): Promise<Result<{ stdout: string; stderr: string }, Error>> {
  return new Promise((resolve) => {
    const proc = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdoutRemainder = "";
    let stderrRemainder = "";
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (options?.timeoutMs) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
      }, options.timeoutMs);
    }

    proc.stdout?.on("data", (data: Buffer | string) => {
      const chunk = data.toString();
      stdout += chunk;
      stdoutRemainder = flushChunkLines(
        chunk,
        stdoutRemainder,
        (line) => options?.onLogLine?.(line, "stdout"),
      );
    });

    proc.stderr?.on("data", (data: Buffer | string) => {
      const chunk = data.toString();
      stderr += chunk;
      stderrRemainder = flushChunkLines(
        chunk,
        stderrRemainder,
        (line) => options?.onLogLine?.(line, "stderr"),
      );
    });

    proc.on("error", (error) => {
      if (timeoutId) clearTimeout(timeoutId);
      resolve(Result.err(error instanceof Error ? error : new Error(String(error))));
    });

    proc.on("close", (code) => {
      if (timeoutId) clearTimeout(timeoutId);

      if (stdoutRemainder.trim().length > 0) {
        options?.onLogLine?.(stdoutRemainder, "stdout");
      }
      if (stderrRemainder.trim().length > 0) {
        options?.onLogLine?.(stderrRemainder, "stderr");
      }

      if (timedOut) {
        resolve(
          Result.err(new Error(`docker ${args.join(" ")} timed out`)),
        );
        return;
      }

      if (code !== 0) {
        resolve(
          Result.err(
            new Error(
              `docker ${args.join(" ")} exited with code ${code ?? 1}${
                stderr ? `: ${stderr.trim()}` : ""
              }`,
            ),
          ),
        );
        return;
      }

      resolve(Result.ok({ stdout, stderr }));
    });
  });
}

export async function stackDeploy(
  stackName: string,
  composeContent: string,
  options?: {
    onLogLine?: (line: string, stream: StackCommandStream) => void;
  },
): Promise<Result<void, Error>> {
  const tmpFile = join(
    STACK_TMP_DIR,
    `${stackName}-${randomBytes(4).toString("hex")}.yml`,
  );

  try {
    mkdirSync(STACK_TMP_DIR, { recursive: true });
    writeFileSync(tmpFile, composeContent, "utf-8");

    const deployResult = await runDockerCommand(
      ["stack", "deploy", "-c", tmpFile, stackName],
      {
        timeoutMs: 60_000,
        onLogLine: options?.onLogLine,
      },
    );
    if (deployResult.isErr()) return deployResult;

    log.info({ stackName }, "Stack deployed");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, stackName }, "Failed to deploy stack");
    return Result.err(err);
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }
  }
}

export async function stackRemove(
  stackName: string,
  options?: {
    onLogLine?: (line: string, stream: StackCommandStream) => void;
  },
): Promise<Result<void, Error>> {
  try {
    const removeResult = await runDockerCommand(["stack", "rm", stackName], {
      timeoutMs: 30_000,
      onLogLine: options?.onLogLine,
    });
    if (removeResult.isErr()) return removeResult;

    log.info({ stackName }, "Stack removed");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, stackName }, "Failed to remove stack");
    return Result.err(err);
  }
}

export async function stackServices(
  stackName: string,
): Promise<Result<StackServiceInfo[], Error>> {
  try {
    const output = execSync(
      `docker stack services "${stackName}" --format "{{.Name}}\\t{{.Replicas}}\\t{{.Image}}"`,
      { encoding: "utf-8", timeout: 15_000 },
    );

    const services = output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("\t");
        return {
          name: parts[0] ?? "",
          replicas: parts[1] ?? "",
          image: parts[2] ?? "",
        };
      });

    return Result.ok(services);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, stackName }, "Failed to list stack services");
    return Result.err(err);
  }
}
