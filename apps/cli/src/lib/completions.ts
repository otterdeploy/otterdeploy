/**
 * Shell-completion generation. Walks the resolved citty command tree so the
 * scripts never drift from the real command set — add a command and its
 * completion appears automatically on the next `otterdeploy completions` run.
 *
 * Covers command/subcommand names and each command's long flags. Two levels
 * deep is enough for this CLI's shape (group → subcommand).
 */

import type { ArgsDef, CommandDef } from "citty";

interface CommandNode {
  name: string;
  flags: string[];
  children: CommandNode[];
}

async function resolve<T>(value: T | (() => T | Promise<T>)): Promise<T> {
  return typeof value === "function" ? await (value as () => T | Promise<T>)() : value;
}

function flagsOf(args: ArgsDef | undefined): string[] {
  if (!args) return [];
  return Object.entries(args)
    .filter(([, def]) => (def as { type?: string }).type !== "positional")
    .map(([name]) => `--${name}`);
}

export async function buildTree(cmd: CommandDef, name: string): Promise<CommandNode> {
  const args = (await resolve(cmd.args)) as ArgsDef | undefined;
  const subs = (await resolve(cmd.subCommands)) as Record<string, CommandDef> | undefined;
  const children: CommandNode[] = [];
  if (subs) {
    for (const [subName, subCmd] of Object.entries(subs)) {
      children.push(await buildTree(await resolve(subCmd), subName));
    }
  }
  return { name, flags: flagsOf(args), children };
}

const COMMON_FLAGS = ["--help", "--json", "--yes", "--url", "--config", "--slug"];

function bashScript(root: CommandNode): string {
  const top = root.children.map((c) => c.name).join(" ");
  const subCases = root.children
    .filter((c) => c.children.length > 0)
    .map(
      (c) =>
        `    ${c.name}) COMPREPLY=($(compgen -W "${c.children.map((s) => s.name).join(" ")}" -- "$cur")); return;;`,
    )
    .join("\n");
  return `# otterdeploy bash completion. Install: otterdeploy completions bash > /etc/bash_completion.d/otterdeploy
_otterdeploy() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=($(compgen -W "${top} --version --help" -- "$cur")); return
  fi
  case "\${COMP_WORDS[1]}" in
${subCases}
  esac
  if [[ "$cur" == -* ]]; then
    COMPREPLY=($(compgen -W "${COMMON_FLAGS.join(" ")}" -- "$cur"))
  fi
}
complete -F _otterdeploy otterdeploy
`;
}

function zshScript(root: CommandNode): string {
  const top = root.children.map((c) => `'${c.name}'`).join(" ");
  const subCases = root.children
    .filter((c) => c.children.length > 0)
    .map(
      (c) =>
        `      ${c.name}) _values 'subcommand' ${c.children.map((s) => `'${s.name}'`).join(" ")} ;;`,
    )
    .join("\n");
  // NB: don't name the static list `words` — that shadows zsh's special
  // command-line array, which the `case` below reads to find the subcommand.
  return `#compdef otterdeploy
# otterdeploy zsh completion. Install: otterdeploy completions zsh > "\${fpath[1]}/_otterdeploy"
_otterdeploy() {
  local -a cmds; cmds=(${top} '--version' '--help')
  if (( CURRENT == 2 )); then
    _values 'command' \${cmds[@]}
    return
  fi
  case "\${words[2]}" in
${subCases}
  esac
}
_otterdeploy "$@"
`;
}

function fishScript(root: CommandNode): string {
  const lines: string[] = [
    "# otterdeploy fish completion. Install: otterdeploy completions fish > ~/.config/fish/completions/otterdeploy.fish",
    "complete -c otterdeploy -f",
  ];
  for (const c of root.children) {
    lines.push(`complete -c otterdeploy -n __fish_use_subcommand -a ${c.name}`);
    for (const s of c.children) {
      lines.push(`complete -c otterdeploy -n "__fish_seen_subcommand_from ${c.name}" -a ${s.name}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function renderCompletion(
  root: CommandDef,
  shell: "bash" | "zsh" | "fish",
): Promise<string> {
  const tree = await buildTree(root, "otterdeploy");
  if (shell === "bash") return bashScript(tree);
  if (shell === "zsh") return zshScript(tree);
  return fishScript(tree);
}
