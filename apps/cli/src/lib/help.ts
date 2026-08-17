/**
 * Help and usage rendering: a full replacement for citty's `renderUsage`.
 *
 * citty's default output has three problems at this CLI's size. It prints a
 * `USAGE` line listing all 34 commands pipe-separated, which wraps into an
 * unreadable wall. It prints one flat alphabetical-ish list, so there is no way
 * to tell that `rollback` is day-2 ops and `init` is setup. And it renders
 * argument tables with backticks and fixed padding that fight the rest of the
 * output.
 *
 * What replaces it, following bd: commands bucketed into ordered, titled groups;
 * bold uppercase section headers; one dim column of descriptions; and a footer
 * pointing at the next thing to read. Every name echoes the bin the user
 * actually typed (see name.ts), so `otd --help` teaches `otd`.
 *
 * Wired in via `runMain(cmd, { showUsage })`, which citty calls for `--help`,
 * for an unknown command, and for a group invoked with no subcommand.
 */

import type { ArgsDef, CommandDef, CommandMeta, Resolvable, SubCommandsDef } from "citty";

import { renderBanner } from "./banner";
import { EXAMPLES, exampleKey } from "./help-content";
import { invokedName } from "./name";
import { bold, dim, G, line, out, padEnd, section, width } from "./ui";

export interface CommandGroup {
  title: string;
  commands: SubCommandsDef;
}

/**
 * The subset of a citty command this renderer reads.
 *
 * citty's `CommandDef<T>` is invariant in `T` through its `setup`/`cleanup`
 * callbacks, so a `CommandDef<{url: StringArgDef}>` is not assignable to
 * `CommandDef<ArgsDef>`, which is why citty's own `SubCommandsDef` reaches for
 * `any`. `no-explicit-any` is an error here, so instead of widening we narrow:
 * help only ever reads meta, args and subCommands, and this states exactly that.
 */
interface HelpCommand {
  meta?: Resolvable<CommandMeta | undefined>;
  args?: Resolvable<ArgsDef | undefined>;
  subCommands?: Resolvable<Record<string, Resolvable<HelpCommand>> | undefined>;
  run?: unknown;
}

let groups: CommandGroup[] = [];

/** Registered once from index.ts, which owns the grouping. */
export function setCommandGroups(next: CommandGroup[]): void {
  groups = next;
}

/**
 * citty's `Resolvable` treats any function value as a thunk to call, so a
 * runtime `typeof` check is the faithful discriminator here (none of the
 * resolved payloads -- meta, args, subcommand maps -- are themselves functions).
 */
function isThunk<T>(value: T | (() => T | Promise<T>) | Promise<T>): value is () => T | Promise<T> {
  return typeof value === "function";
}

async function resolve<T>(value: T | (() => T | Promise<T>) | Promise<T>): Promise<T> {
  return isThunk(value) ? await value() : await value;
}

/**
 * The command path the user typed, e.g. `["domains", "add"]`.
 *
 * Taken from argv rather than citty's `(cmd, parent)` pair, which only carries
 * the immediate parent and so cannot render a three-level usage line.
 */
function commandPath(): string[] {
  return process.argv.slice(2).filter((token) => !token.startsWith("-"));
}

/**
 * What a string flag's value looks like, inferred from the flag's name.
 *
 * citty reads this from a per-arg `valueHint`, which none of the 34 commands
 * set, so every string flag rendered as a useless `<value>`. Inferring from
 * the name fixes all of them at once and keeps the hint from drifting out of
 * sync with a flag it was hand-written for.
 */
const VALUE_HINTS: Record<string, string> = {
  config: "path",
  file: "path",
  out: "path",
  "mount-path": "path",
  "compose-path": "path",
  url: "url",
  "git-url": "url",
  "git-ref": "ref",
  slug: "slug",
  project: "slug",
  tail: "n",
  limit: "n",
  replica: "n",
  timeout: "minutes",
  since: "time",
  expires: "duration",
  engine: "engine",
  env: "name",
  name: "name",
  service: "name",
  database: "name",
  destination: "name",
  deployment: "id",
  backupId: "id",
  shell: "shell",
  host: "host",
  action: "action",
  actor: "actor",
  search: "text",
  confirm: "name",
  format: "format",
  image: "image",
};

/** `--tail <n>`, `--no-follow`, `-h, --help`: one flag as the user types it. */
function formatFlag(name: string, def: ArgsDef[string]): string {
  // `alias` exists on flag defs only; positional defs omit it, hence the `in`.
  const aliasRaw = "alias" in def ? def.alias : undefined;
  const aliasList = Array.isArray(aliasRaw) ? aliasRaw : aliasRaw ? [aliasRaw] : [];
  const aliases = aliasList.map((a) => `-${a}`);
  // A boolean defaulting to true is only ever *disabled*, so show the negation
  // the user would actually type.
  const flag = def.type === "boolean" && def.default === true ? `--no-${name}` : `--${name}`;
  const value = def.type === "string" ? ` <${def.valueHint ?? VALUE_HINTS[name] ?? "value"}>` : "";
  return [...aliases, flag].join(", ") + value;
}

/**
 * A two-column block: name on the left, dim description on the right.
 *
 * `minWidth` lets several blocks share one column so the groups in root help
 * line up as a single table instead of six independently-measured ones.
 */
function describeList(entries: Array<[string, string]>, minWidth = 0): void {
  if (entries.length === 0) return;
  const nameWidth = Math.max(minWidth, ...entries.map(([name]) => width(name)));
  for (const [name, description] of entries) {
    out(`  ${padEnd(name, nameWidth)}  ${dim(description)}`);
  }
}

async function subcommandEntries(cmd: HelpCommand): Promise<Array<[string, string]>> {
  const subs = await resolve(cmd.subCommands);
  if (!subs) return [];
  const entries: Array<[string, string]> = [];
  for (const [name, sub] of Object.entries(subs)) {
    const meta = await resolve((await resolve(sub)).meta);
    entries.push([name, meta?.description ?? ""]);
  }
  return entries;
}

function argEntries(args: ArgsDef): {
  positionals: Array<[string, string]>;
  flags: Array<[string, string]>;
  usage: string[];
} {
  const positionals: Array<[string, string]> = [];
  const flags: Array<[string, string]> = [];
  const usage: string[] = [];
  for (const [name, def] of Object.entries(args)) {
    if (def.type === "positional") {
      // Angle brackets for required, square for optional, and the ARGUMENTS
      // list uses the same notation as the usage line, so the two agree.
      const token = def.required !== false ? `<${name}>` : `[${name}]`;
      positionals.push([token, def.description ?? ""]);
      usage.push(token);
      continue;
    }
    flags.push([formatFlag(name, def), def.description ?? ""]);
  }
  return { positionals, flags, usage };
}

/** Flags citty or the entry point handles for every command. */
const GLOBAL_FLAGS: Array<[string, string]> = [
  ["-h, --help", "Show help for a command"],
  ["-v, --version", "Print the CLI version"],
  ["--no-color", "Disable colour (also honours NO_COLOR)"],
];

async function renderRootHelp(cmd: HelpCommand): Promise<void> {
  const meta = await resolve(cmd.meta);
  const bin = invokedName();
  out(renderBanner({ subtitle: `v${meta?.version ?? ""}` }));
  out();
  line(dim(meta?.description ?? ""));

  section("Usage");
  line(`${bold(bin)} <command> [options]`);
  line(dim(`${bin} <command> --help    options for one command`));

  // Grouped commands: the whole reason this renderer exists.
  const grouped: Array<{ title: string; entries: Array<[string, string]> }> = [];
  for (const group of groups) {
    const entries: Array<[string, string]> = [];
    for (const [name, sub] of Object.entries(group.commands)) {
      const subMeta = await resolve((await resolve(sub)).meta);
      entries.push([name, subMeta?.description ?? ""]);
    }
    grouped.push({ title: group.title, entries });
  }

  // One column width across every group, so the six blocks read as a single
  // table split by headers rather than six independently-ragged lists.
  const columnWidth = Math.max(
    ...grouped.flatMap(({ entries }) => entries.map(([name]) => width(name))),
  );

  for (const { title, entries } of grouped) {
    section(title);
    describeList(entries, columnWidth);
  }

  section("Global options");
  describeList(GLOBAL_FLAGS);

  out();
  describeList(
    [
      [`${G.next} ${bin} <command> --help`, "options for one command"],
      [`${G.next} ${bin} completions <shell>`, "enable tab completion"],
    ].map(([left, right]) => [dim(left ?? ""), right ?? ""]),
  );
  out();
}

/**
 * The usage line(s) for one command. A group that also has its own `run` gets
 * both forms (`otd env <command>` and `otd env [options]`) because both are
 * real ways to invoke it.
 */
function renderUsageLines(
  full: string,
  opts: { hasSubs: boolean; runnable: boolean; usage: string[]; hasFlags: boolean },
): void {
  section("Usage");
  if (opts.hasSubs) line(`${bold(full)} <command> [options]`);
  if (opts.hasSubs && !opts.runnable) return;
  const tail = [...opts.usage, opts.hasFlags ? "[options]" : ""].filter(Boolean).join(" ");
  line(`${bold(full)}${tail ? ` ${tail}` : ""}`);
}

function renderExamples(bin: string, path: string[]): void {
  const examples = EXAMPLES[exampleKey(path)];
  if (!examples?.length) return;
  section("Examples");
  for (const example of examples) {
    line(dim(`# ${example.note}`));
    line(`${bin} ${example.run}`);
    out();
  }
}

async function renderCommandHelp(cmd: HelpCommand, path: string[]): Promise<void> {
  const meta = await resolve(cmd.meta);
  const bin = invokedName();
  const full = [bin, ...path].join(" ");

  out();
  line(dim(meta?.description ?? ""));

  const subs = await subcommandEntries(cmd);
  const args: ArgsDef = (await resolve(cmd.args)) ?? {};
  const { positionals, flags, usage } = argEntries(args);
  const hasSubs = subs.length > 0;

  renderUsageLines(full, {
    hasSubs,
    runnable: Boolean(cmd.run),
    usage,
    hasFlags: flags.length > 0,
  });

  if (hasSubs) {
    section("Commands");
    describeList(subs);
  }
  if (positionals.length > 0) {
    section("Arguments");
    describeList(positionals);
  }
  if (flags.length > 0) {
    section("Options");
    describeList(flags);
  }

  renderExamples(bin, path);

  if (hasSubs) {
    out();
    line(dim(`${G.next} ${full} <command> --help  for a subcommand's options`));
  }
  out();
}

/**
 * Drop-in for citty's `showUsage`, passed to `runMain`. Generic in the command's
 * args so it matches the signature citty expects of a replacement.
 */
export async function showUsage<T extends ArgsDef = ArgsDef>(cmd: CommandDef<T>): Promise<void> {
  const command: HelpCommand = cmd;
  const path = commandPath();
  if (path.length === 0) {
    await renderRootHelp(command);
    return;
  }
  await renderCommandHelp(command, path);
}
