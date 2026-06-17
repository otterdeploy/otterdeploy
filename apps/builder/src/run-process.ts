/**
 * Spawn a child process and tee stdout/stderr through a LogSink.
 *
 * Used for every shell-out the builder does: `git clone`, `nixpacks
 * build`, `docker login`, `docker push`. Output is line-split on the
 * fly so the LogSink sees one row per logical line (and not an
 * arbitrary chunk boundary).
 *
 * Resolves with the exit code on completion; never rejects on a
 * non-zero exit — callers decide how to handle build vs push failures.
 *
 * `secrets` are values to mask before writing to logs (e.g. an
 * installation token in a git remote URL). Each occurrence is
 * replaced with `***` so a logged command line doesn't leak the token.
 *
 * `stdin` lets callers pipe a value in (used by `docker login
 * --password-stdin` so the password never appears on the command line
 * or in env).
 */

import { spawn } from "node:child_process";

import type { LogSink } from "./log-stream";

export interface RunResult {
  exitCode: number;
  /** Combined stdout + stderr, capped at 64KB. Useful for error messages. */
  tail: string;
}

async function runProcess(opts: {
  cmd: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  sink: LogSink;
  secrets?: string[];
  stdin?: string;
  /** Echo the command line as a `system` log line. Default true. */
  echo?: boolean;
}): Promise<RunResult> {
  const echo = opts.echo ?? true;
  if (echo) {
    opts.sink.system(`$ ${maskCommand(opts.cmd, opts.args, opts.secrets)}`);
  }

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(opts.cmd, opts.args, {
      cwd: opts.cwd,
      // Inheriting the builder process env is the point: docker /
      // nixpacks need PATH, HOME, and any DOCKER_* config the operator
      // set on the host. Per-call overrides go in opts.env.
      // eslint-disable-next-line node/no-process-env
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let tail = "";
    const TAIL_CAP = 64 * 1024;
    const appendTail = (chunk: string) => {
      tail += chunk;
      if (tail.length > TAIL_CAP) tail = tail.slice(-TAIL_CAP);
    };

    pipeLines(child.stdout, (line) => {
      const masked = maskSecrets(line, opts.secrets);
      opts.sink.write("stdout", masked);
      appendTail(masked + "\n");
    });
    pipeLines(child.stderr, (line) => {
      const masked = maskSecrets(line, opts.secrets);
      opts.sink.write("stderr", masked);
      appendTail(masked + "\n");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? -1, tail });
    });

    if (opts.stdin !== undefined) {
      child.stdin.end(opts.stdin);
    } else {
      child.stdin.end();
    }
  });
}

function pipeLines(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
) {
  let carry = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    carry += chunk;
    let idx: number;
    while ((idx = carry.indexOf("\n")) !== -1) {
      const line = carry.slice(0, idx);
      carry = carry.slice(idx + 1);
      if (line.length > 0) onLine(line);
    }
  });
  stream.on("end", () => {
    if (carry.length > 0) onLine(carry);
  });
}

function maskCommand(cmd: string, args: string[], secrets?: string[]): string {
  const joined = [cmd, ...args].map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ");
  return maskSecrets(joined, secrets);
}

function maskSecrets(s: string, secrets?: string[]): string {
  if (!secrets || secrets.length === 0) return s;
  let out = s;
  for (const secret of secrets) {
    if (!secret) continue;
    // Split-and-rejoin avoids needing to regex-escape the secret.
    out = out.split(secret).join("***");
  }
  return out;
}
