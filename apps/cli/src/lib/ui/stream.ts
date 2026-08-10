/**
 * Output stream discipline.
 *
 * A command's *result* goes to stdout; anything about how the command went goes
 * to stderr. That is what makes `otd deployments --json | jq` and
 * `otd export > stack.yml` work without a `2>/dev/null`. A warning about DNS
 * can never land in the middle of piped data.
 *
 * Concretely: tables, detail blocks, JSON and confirmations write to stdout;
 * failures, warnings and next-step hints write to stderr. `consola` sent
 * everything to stdout, which is why this module exists.
 */

export function out(line = ""): void {
  process.stdout.write(`${line}\n`);
}

export function err(line = ""): void {
  process.stderr.write(`${line}\n`);
}

/** True when stdout is a terminal, gates spinners, prompts and the banner. */
export function interactive(): boolean {
  return Boolean(process.stdout.isTTY);
}
