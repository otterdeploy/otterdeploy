import { spawn as nodeSpawn } from "node:child_process";

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs a command and captures stdout/stderr.
 * Uses Bun.spawn when available, falls back to node:child_process.
 */
export async function runCommand(
  cmd: string[],
  options?: { timeout?: number },
): Promise<SpawnResult> {
  const command = cmd[0]!;
  const args = cmd.slice(1);

  // Use Bun.spawn when running in Bun runtime
  if (typeof globalThis.Bun !== "undefined") {
    const proc = Bun.spawn(cmd, {
      stdout: "pipe",
      stderr: "pipe",
    });

    let killed = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (options?.timeout) {
      timeoutId = setTimeout(() => {
        killed = true;
        proc.kill();
      }, options.timeout);
    }

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    if (timeoutId) clearTimeout(timeoutId);

    const exitCode = await proc.exited;

    if (killed) {
      return { exitCode: -1, stdout, stderr: stderr + "\nProcess timed out" };
    }

    return { exitCode, stdout, stderr };
  }

  // Fallback: node:child_process
  return new Promise<SpawnResult>((resolve, reject) => {
    const proc = nodeSpawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let killed = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (options?.timeout) {
      timeoutId = setTimeout(() => {
        killed = true;
        proc.kill();
      }, options.timeout);
    }

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (killed) {
        resolve({ exitCode: -1, stdout, stderr: stderr + "\nProcess timed out" });
      } else {
        resolve({ exitCode: code ?? 1, stdout, stderr });
      }
    });

    proc.on("error", (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(err);
    });
  });
}
