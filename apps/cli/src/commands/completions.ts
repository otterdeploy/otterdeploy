import type { CommandDef } from "citty";

import { defineCommand } from "citty";

import { renderCompletion } from "../lib/completions";
import { cmd, invokedName } from "../lib/name";
import { abort } from "../lib/ui";

// Built lazily against the live root command so completions never drift from
// the registry. index.ts injects the root via `rootCommand` after wiring.
let rootCommand: CommandDef | null = null;
export function setCompletionRoot(root: CommandDef): void {
  rootCommand = root;
}

export const completionsCommand = defineCommand({
  meta: {
    name: "completions",
    description: "Print a shell completion script (bash | zsh | fish)",
  },
  args: {
    shell: { type: "positional", required: false, description: "bash | zsh | fish" },
  },
  async run({ args }) {
    const shell = args.shell;
    if (shell !== "bash" && shell !== "zsh" && shell !== "fish") {
      abort(
        shell === undefined ? "Which shell?" : `Unsupported shell "${shell}".`,
        `run \`${cmd("completions bash")}\`, \`zsh\`, or \`fish\``,
      );
    }
    if (!rootCommand) {
      abort("Completion root not initialized.");
    }
    // The generated script binds to the name the user invoked, so `otd` and
    // `otterdeploy` each get completions under their own command name.
    process.stdout.write(await renderCompletion(rootCommand, shell, invokedName()));
  },
});
