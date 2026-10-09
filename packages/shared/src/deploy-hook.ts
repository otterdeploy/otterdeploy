/**
 * What a stored pre/post-deploy hook means, in one place.
 *
 * A hook is stored as `text[]` and has had two readings:
 *
 *   - EXEC FORM (the manifest's): the array is ONE command's argv.
 *     `["bundle", "exec", "rails", "db:prepare"]` runs `bundle` with three
 *     arguments, and the manifest's string shorthand `"a && b"` is stored as
 *     `["sh", "-c", "a && b"]`.
 *   - LEGACY SHELL LINES (what the settings editor and the service API used to
 *     write): each element is a whole shell line, run in order.
 *
 * The builder ran EVERY array as shell lines, so the documented exec form
 * broke: mastodon's `["bundle","exec","rails","db:prepare"]` ran `sh -c
 * bundle`, `sh -c exec`, ... and died with exit 23, and the
 * string shorthand ran `sh -c sh` then `sh -c -c`.
 *
 * Both readings are kept, told apart by argv[0]: a program name never contains
 * whitespace, so an array whose first element does ("bun run db:migrate") can
 * only be the legacy list of shell lines. Everything else is exec form. That
 * keeps every hook an operator saved before this fix running as they meant it.
 */

/** The argv of each container a stored hook runs, in order. */
export function hookInvocations(stored: readonly string[]): string[][] {
  const [program] = stored;
  if (program === undefined) return [];
  if (/\s/.test(program)) {
    return stored.flatMap((line) => (line.trim() ? [["sh", "-c", line]] : []));
  }
  return [[...stored]];
}

const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** POSIX-quote one argument so a shell reads it back as exactly that word. */
function shellQuote(arg: string): string {
  if (SHELL_SAFE.test(arg)) return arg;
  return `'${arg.replaceAll("'", `'"'"'`)}'`;
}

/** A shell-line join that splits back to the same rows; see {@link hookFromShellLines}. */
const LINE_JOIN = " && ";

/**
 * The stored hook as editable shell lines (the settings editor's rows).
 * `["sh", "-c", "a && b"]` reads as two rows; any other exec form reads as
 * one shell-quoted line that runs the same argv.
 */
export function hookShellLines(stored: readonly string[]): string[] {
  const [program, flag, script, ...rest] = stored;
  if (program === undefined) return [];
  if (program === "sh" && flag === "-c" && script !== undefined && rest.length === 0) {
    return script.split(LINE_JOIN);
  }
  if (/\s/.test(program)) return [...stored];
  return [stored.map(shellQuote).join(" ")];
}

/**
 * Editor rows back to the stored exec form: one `sh -c` that runs the lines in
 * order and stops at the first failure, or null when there are none.
 */
export function hookFromShellLines(lines: readonly string[]): string[] | null {
  const kept = lines.map((l) => l.trim()).filter((l) => l.length > 0);
  if (kept.length === 0) return null;
  return ["sh", "-c", kept.join(LINE_JOIN)];
}
