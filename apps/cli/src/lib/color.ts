/**
 * Honor `NO_COLOR` (https://no-color.org) and a `--no-color` flag. consola's
 * color detection reads `NO_COLOR` from the environment, so the flag is
 * implemented by setting that var before any command output is formatted.
 * Called once at startup, before `runMain`.
 */

// oxlint-disable-next-line node/no-process-env -- standalone CLI env boundary
const env = process.env;

export function applyColorPreference(argv: string[]): void {
  if (argv.includes("--no-color") && !env.NO_COLOR) {
    env.NO_COLOR = "1";
  }
}
