import { spawn as nodeSpawn } from "node:child_process";

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type StreamName = "stdout" | "stderr";

function emitLines(
  text: string,
  previousRemainder: string,
  onLine?: (line: string) => void,
): string {
  const combined = `${previousRemainder}${text}`;
  const parts = combined.split(/\r?\n/);
  const remainder = parts.pop() ?? "";

  for (const line of parts) {
    if (line.length === 0) continue;
    onLine?.(line);
  }

  return remainder;
}

/**
 * Runs a command and captures stdout/stderr.
 * Emits line callbacks as data arrives.
 */
export async function runCommand(
  cmd: string[],
  options?: {
    timeout?: number;
    onStdoutLine?: (line: string) => void;
    onStderrLine?: (line: string) => void;
  },
): Promise<SpawnResult> {
  const command = cmd[0]!;
  const args = cmd.slice(1);

  return new Promise<SpawnResult>((resolve, reject) => {
    const proc = nodeSpawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdoutRemainder = "";
    let stderrRemainder = "";
    let killed = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (options?.timeout) {
      timeoutId = setTimeout(() => {
        killed = true;
        proc.kill();
      }, options.timeout);
    }

    const handleLine = (stream: StreamName, line: string) => {
      try {
        if (stream === "stdout") {
          options?.onStdoutLine?.(line);
        } else {
          options?.onStderrLine?.(line);
        }
      } catch {
        // callback failures should not crash the build process
      }
    };

    proc.stdout?.on("data", (data: Buffer | string) => {
      const chunk = data.toString();
      const nextRemainder = emitLines(
        chunk,
        stdoutRemainder,
        (line) => handleLine("stdout", line),
      );
      stdout += chunk;
      stdoutRemainder = nextRemainder;
    });

    proc.stderr?.on("data", (data: Buffer | string) => {
      const chunk = data.toString();
      const nextRemainder = emitLines(
        chunk,
        stderrRemainder,
        (line) => handleLine("stderr", line),
      );
      stderr += chunk;
      stderrRemainder = nextRemainder;
    });

    proc.on("close", (code) => {
      if (timeoutId) clearTimeout(timeoutId);

      if (stdoutRemainder.length > 0) {
        handleLine("stdout", stdoutRemainder);
      }
      if (stderrRemainder.length > 0) {
        handleLine("stderr", stderrRemainder);
      }

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
