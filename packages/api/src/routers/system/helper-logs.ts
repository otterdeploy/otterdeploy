/**
 * Reading the update helper's output.
 *
 * Split from apply.ts, which owns the update's control flow and had grown past
 * the file cap. These three are one concern: the helper container is where the
 * update actually happens, and this is the only window onto it.
 */
import type { Readable } from "node:stream";

import { Docker, demuxStream } from "@otterdeploy/docker";
import { Result } from "better-result";

import * as state from "./state";

/**
 * Emit the helper's new output as progress, returning the new line count.
 *
 * The old server stays alive from handoff until compose recreates it, which
 * is most of the update. Polling for the exit code alone wasted that window:
 * `watchCutover` only ever spoke when the helper EXITED, and on a successful
 * cutover this process is killed before that happens, so the successful path
 * reported nothing after "launching helper".
 *
 * Relaying is best-effort and deliberately silent on failure — a log read
 * that blips must not fail an update in flight — and skipped once the stream
 * has gone quiet, so a helper that prints nothing costs nothing.
 */
export async function relayHelperProgress(
  container: ReturnType<Docker["containers"]["getContainer"]>,
  alreadyRelayed: number,
): Promise<number> {
  const res = await container.logs({ follow: false, stdout: true, stderr: true, tail: "200" });
  if (res.isErr()) return alreadyRelayed;
  const { stdout, stderr } = demuxStream(res.value);
  const collected = await Result.tryPromise({
    try: () => Promise.all([collect(stdout), collect(stderr)]),
    catch: (cause) => cause,
  });
  if (collected.isErr()) return alreadyRelayed;
  const [out, err] = collected.value;
  const lines = `${out.toString("utf8")}${err.toString("utf8")}`
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "");
  // `tail` caps what we can see, so a helper noisier than the cap would make
  // the count slide backwards and replay lines. Only ever move forwards.
  if (lines.length <= alreadyRelayed) return alreadyRelayed;
  for (const line of lines.slice(alreadyRelayed)) {
    state.emit("recreate", line);
  }
  return lines.length;
}

export async function readHelperLogs(
  container: ReturnType<Docker["containers"]["getContainer"]>,
): Promise<string> {
  const res = await container.logs({ follow: false, stdout: true, stderr: true, tail: "40" });
  if (res.isErr()) return "";
  const { stdout, stderr } = demuxStream(res.value);
  const [out, err] = await Promise.all([collect(stdout), collect(stderr)]);
  const text = `${out.toString("utf8")}${err.toString("utf8")}`.trim();
  return text ? `Helper output:\n${text.slice(-1500)}` : "";
}

function collect(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
