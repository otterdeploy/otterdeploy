/**
 * Single-line messages: outcomes, failures, warnings and next-step hints.
 *
 * This replaces bare `consola.*` calls across the commands. Three things it
 * fixes beyond looks:
 *
 * 1. **Stream discipline** — failures, warnings and hints go to stderr, results
 *    to stdout (see stream.ts), so `--json` output stays pipeable.
 * 2. **Hints are first-class.** A failure almost always has a next action; the
 *    old code either dropped it or buried it in the message. `abort(msg, hint)`
 *    makes the recovery path part of the signature.
 * 3. **Consistent prefixes.** One glyph column, always in the same place, so
 *    output scans vertically instead of as ragged prose.
 *
 * Most prompts delegate to `consola.prompt`: it is a tested TTY widget with
 * cancel handling and arrow-key select. What is standardised here is the
 * question wording, the default, and what a cancel means. The one exception is
 * `secret`, which consola cannot express — see its comment.
 */

import { consola } from "consola";
import { StringDecoder } from "node:string_decoder";

import { cmd } from "../name";
import { G } from "./glyphs";
import { err, out } from "./stream";
import { dim, paint, strong } from "./theme";

/** Raw stderr write with no trailing newline — for in-place prompts. */
function writeInline(text: string): void {
  process.stderr.write(text);
}

/** A successful outcome — the thing the user asked for happened. */
export function ok(message: string): void {
  out(`${strong("ok", G.check)} ${message}`);
}

/** Neutral information about the result. Not a warning, not an outcome. */
export function note(message: string): void {
  out(`${dim(G.info)} ${message}`);
}

/** Something worth knowing that did not stop the command. */
export function warn(message: string): void {
  err(`${strong("warn", G.bang)} ${paint("warn", message)}`);
}

/**
 * A next action, indented under whatever it follows and led by `→`.
 * Backtick-quote the runnable part so it survives copy-paste into a shell.
 */
export function hint(text: string): void {
  err(`  ${dim(`${G.next} ${text}`)}`);
}

/** Like `hint`, but the text IS a command — prefixed with the invoked name. */
export function hintCmd(rest: string): void {
  hint(`run \`${cmd(rest)}\``);
}

/** Report a failure without exiting. Prefer `abort` unless recovery follows. */
export function fail(message: string, ...hints: string[]): void {
  err(`${strong("danger", G.cross)} ${paint("danger", message)}`);
  for (const h of hints) hint(h);
}

/**
 * Report a failure and exit non-zero.
 *
 * Collapses the `consola.error(...); process.exit(1)` pair that appeared ~90
 * times, and makes it impossible to print an error and forget the exit code —
 * which silently turned failures into CI passes.
 */
export function abort(message: string, ...hints: string[]): never {
  fail(message, ...hints);
  process.exit(1);
}

/**
 * A yes/no question. Defaults to *no* for anything destructive, so a bare
 * Enter or a piped stdin can never approve a deletion.
 *
 * Returns false when the user declines or cancels (Ctrl-C on the prompt), so
 * callers treat both the same way.
 */
export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const answer = await consola.prompt(question, {
    type: "confirm",
    initial: defaultYes,
    cancel: "default",
  });
  return answer === true;
}

/** Free-text input. Returns null when cancelled. */
export async function ask(question: string, placeholder?: string): Promise<string | null> {
  const answer = await consola.prompt(question, {
    type: "text",
    ...(placeholder === undefined ? {} : { placeholder }),
    cancel: "default",
  });
  return typeof answer === "string" && answer !== "" ? answer : null;
}

/** Pick one of `options`. Returns null when cancelled. */
export async function select(question: string, options: string[]): Promise<string | null> {
  const answer = await consola.prompt(question, {
    type: "select",
    options,
    cancel: "default",
  });
  return typeof answer === "string" ? answer : null;
}

const CTRL_C = 3;
const BACKSPACE = 127;
const BACKSPACE_ALT = 8;
const CR = 13;
const LF = 10;

/**
 * Masked input for a password or one-time code. Returns null if cancelled or if
 * there is no TTY to read from.
 *
 * Hand-rolled because `consola.prompt` has no password type, so the step-up
 * prompts in `exec` were echoing passwords into the terminal and its scrollback.
 * Reading raw bytes and echoing nothing is the only way to avoid that.
 *
 * Bytes are decoded through a StringDecoder so a non-ASCII passphrase survives
 * being split across chunk boundaries.
 */
export function secret(question: string): Promise<string | null> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return Promise.resolve(null);

  return new Promise<string | null>((resolve) => {
    // The prompt goes to stderr so it never contaminates piped stdout.
    writeInline(`${dim(G.next)} ${question}: `);
    const decoder = new StringDecoder("utf8");
    let value = "";

    const finish = (result: string | null): void => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      writeInline("\n");
      resolve(result);
    };

    const onData = (chunk: Buffer): void => {
      for (const byte of chunk) {
        if (byte === CTRL_C) return finish(null);
        if (byte === CR || byte === LF) return finish(value);
        if (byte === BACKSPACE || byte === BACKSPACE_ALT) {
          // Drop one whole code point, not one byte, so backspacing a non-ASCII
          // passphrase doesn't leave a broken surrogate behind. Grapheme
          // clusters (emoji with modifiers) are out of scope for a password box.
          // oxlint-disable-next-line typescript/no-misused-spread -- code points are exactly the unit wanted
          value = [...value].slice(0, -1).join("");
          continue;
        }
        value += decoder.write(Buffer.from([byte]));
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}
