import type { CommandDef } from "citty";

import { defineCommand } from "citty";
import { consola } from "consola";

import { renderCompletion } from "../lib/completions";

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
      consola.error("Usage: otterdeploy completions <bash|zsh|fish>");
      process.exit(1);
    }
    if (!rootCommand) {
      consola.error("Completion root not initialized.");
      process.exit(1);
    }
    process.stdout.write(await renderCompletion(rootCommand, shell));
  },
});
