/**
 * The one place a `rustic` child process is spawned. Split from rustic.ts (the
 * profile/password/subcommand surface) because the stdin side is where a
 * backup can silently go wrong, and it needs more care than a pipe() call:
 *
 *   - The dump is fed through `pipeline`, so an EPIPE on the child's stdin
 *     (rustic exited, or stopped reading) settles a promise instead of raising
 *     an unhandled 'error' event that takes the whole server down.
 *   - Every byte handed to rustic is counted, so the caller can prove rustic
 *     stored the whole dump rather than trusting its exit code.
 *   - A dump stream that broke mid-way fails the call even when rustic exits
 *     0: rustic snapshots whatever reached EOF, which would be a truncated dump.
 */
import type { Readable, Writable } from "node:stream";

import { errorFromUnknown } from "@otterdeploy/shared/promise";
import { Result } from "better-result";
import { type ChildProcess, spawn } from "node:child_process";
import { Readable as NodeReadable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/** stderr lines kept for the error text of a failed invocation. */
const ERROR_TAIL_LINES = 16;

/** What one rustic invocation produced. */
export interface RusticOutput {
  /** Collected stdout (empty when stdout was piped to a caller's Writable). */
  stdout: string;
  /** Bytes the dump stream handed to rustic's stdin (0 without stdin). */
  stdinBytes: number;
}

export interface RusticSpawnOptions {
  stdin?: Readable;
  stdout?: Writable;
}

/** Wait for the child to exit; a spawn failure (missing binary) rejects. */
function exitCode(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
}

/** Feed `source` into the child's stdin, counting bytes. Never rejects: a
 *  broken pipe on either side comes back as the Result's error. */
function feedStdin(
  source: Readable,
  childStdin: Writable,
): { bytes: () => number; settled: Promise<Result<void, Error>> } {
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  const settled = Result.tryPromise({
    try: () => pipeline(source, counter, childStdin),
    catch: errorFromUnknown,
  });
  return { bytes: () => bytes, settled };
}

/** Split a text stream into lines for `emit`; returns a flush for the last
 *  (unterminated) line, called once the child has exited. */
function forwardLines(stream: Readable, emit: (line: string) => void): () => void {
  let carry = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    carry += chunk;
    let idx: number;
    while ((idx = carry.indexOf("\n")) !== -1) {
      const line = carry.slice(0, idx);
      carry = carry.slice(idx + 1);
      if (line.length > 0) emit(line);
    }
  });
  return () => {
    if (carry.length > 0) emit(carry);
    carry = "";
  };
}

/** The invocation's verdict: rustic's own failure first (it names the cause,
 *  e.g. a wrong password, better than the EPIPE it left behind), then a dump
 *  that did not arrive intact. */
function assertInvocationSucceeded(
  args: string[],
  exit: Result<number | null, Error>,
  fed: Result<void, Error>,
  errTail: string[],
): void {
  if (exit.isErr()) throw exit.error;
  if (exit.value !== 0) {
    const detail = errTail.slice(-3).join("; ");
    throw new Error(`rustic ${args.join(" ")} exited ${exit.value}${detail ? `: ${detail}` : ""}`);
  }
  if (fed.isErr()) throw new Error(`the dump did not reach rustic intact: ${fed.error.message}`);
}

/** Spawn rustic; stream stderr lines to `onStderr`, collect (or pipe) stdout,
 *  feed + count stdin. Rejects on a non-zero exit (with the stderr tail) and on
 *  a dump stream that did not reach rustic intact. */
export async function spawnRustic(
  binary: string,
  args: string[],
  opts: RusticSpawnOptions,
  onStderr: (line: string) => void,
): Promise<RusticOutput> {
  const child = spawn(binary, args, {
    stdio: ["pipe", "pipe", "pipe"],
    // Inherit PATH etc.; NO_COLOR strips ANSI so logs + error text stay clean.
    // No secrets ride on env or argv: the password lives in the profile.
    // oxlint-disable-next-line node/no-process-env -- inherit host env for the child; per-call additions only.
    env: { ...process.env, NO_COLOR: "1" },
  });
  const exited = Result.tryPromise({ try: () => exitCode(child), catch: errorFromUnknown });

  const outChunks: Buffer[] = [];
  if (opts.stdout) child.stdout.pipe(opts.stdout);
  else child.stdout.on("data", (c: Buffer) => outChunks.push(c));

  const errTail: string[] = [];
  const flushStderr = forwardLines(child.stderr, (line) => {
    errTail.push(line);
    if (errTail.length > ERROR_TAIL_LINES) errTail.shift();
    onStderr(line);
  });

  // Without a dump, stdin is fed an empty stream: closed at once, through the
  // same error-capturing pipeline, and its outcome is irrelevant.
  const feed = feedStdin(opts.stdin ?? NodeReadable.from([]), child.stdin);
  const exit = await exited;
  flushStderr();
  const fed = await feed.settled;
  assertInvocationSucceeded(args, exit, opts.stdin ? fed : Result.ok(), errTail);
  return { stdout: Buffer.concat(outChunks).toString("utf8"), stdinBytes: feed.bytes() };
}
