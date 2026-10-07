/**
 * The command a service's container is started with, given the image it runs.
 *
 * A stored `command` is exec form: `["node", "server.js"]`, one argv word per
 * entry. Docker passes it as the image's CMD, behind whatever ENTRYPOINT the
 * image declares, which is exactly right for a Dockerfile image and for a
 * pulled one.
 *
 * Railpack is the exception. Every Railpack image is built with `ENTRYPOINT
 * ["/bin/bash", "-c"]` and its start command as a one-string CMD (railpack
 * buildkit/convert.go). Handing that entrypoint an exec-form CMD runs `bash -c
 * node server.js`: bash executes the first word alone and binds the rest to
 * `$0`, so the container started a bare `node` that read an empty stdin and
 * exited 0. Behind that entrypoint the argv has to arrive as ONE shell line,
 * each word quoted so it survives the shell intact. bash execs a lone simple
 * command in place, so the app is still PID 1 and still receives the stop
 * signal.
 *
 * A one-entry command is left exactly as stored: on a Railpack image it is
 * already a shell line (the same shape as Railpack's own start command), and
 * `["npm run start"]` has always meant that there.
 */
import type { ImageBuilder } from "@otterdeploy/shared/build-config";

/** A word the shell reads back unchanged without quotes. */
const PLAIN_SHELL_WORD = /^[\w@%+=:,./-]+$/;

/** One argv word as POSIX shell source that yields exactly that word. */
function shellWord(word: string): string {
  if (PLAIN_SHELL_WORD.test(word)) return word;
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/** An exec-form argv as one shell line that runs the same argv. */
function shellLine(argv: readonly string[]): string {
  return argv.map(shellWord).join(" ");
}

/**
 * The CMD to start the container with. `imageBuilder` is the builder that
 * produced the image (null: pulled, or built before that was recorded); an
 * explicit `entrypoint` replaces the image's own, so the command then goes to
 * that entrypoint unchanged.
 */
export function containerCommand(service: {
  command: string[] | null;
  entrypoint: string[] | null;
  imageBuilder: ImageBuilder | null;
}): string[] | null {
  const { command, entrypoint, imageBuilder } = service;
  if (!command || command.length < 2) return command;
  if (imageBuilder !== "railpack") return command;
  if (entrypoint && entrypoint.length > 0) return command;
  return [shellLine(command)];
}
