import type { Manifest } from "@otterdeploy/api/manifest";
import type { ArgsDef } from "citty";

import { defineCommand } from "citty";

import { loadConfig, writeConfig } from "../config-file";
import { cmd } from "../lib/name";
import { suggestions } from "../lib/suggest";
import { abort, confirm, detail, dim, hint, ok, warn } from "../lib/ui";

const removeArgs = {
  name: { type: "positional", required: true, description: "Resource name" },
  config: { type: "string", description: "Path to config file" },
  yes: { type: "boolean", description: "Skip the confirmation prompt" },
} as const satisfies ArgsDef;

function notFound(kind: string, name: string, available: string[]): never {
  abort(
    `No ${kind} named \`${name}\` in the config.`,
    ...suggestions(name, available).map((s) => `did you mean \`${s}\`?`),
    ...(available.length === 0
      ? [`the config declares no ${kind}s`]
      : [`declared: ${available.join(", ")}`]),
  );
}

async function confirmRemoval(kind: string, name: string, yes: boolean | undefined): Promise<void> {
  if (yes) return;
  // This edits a file; the destruction happens on the next deploy. Separating
  // the two makes the prompt honest about what is about to happen right now.
  warn(`The next deploy will DELETE the live ${kind}.`);
  if (!(await confirm(`Remove ${kind} ${name} from the config?`))) {
    abort("Aborted — the config was not changed.");
  }
}

function reportRemoved(kind: string, name: string, path: string): void {
  ok(`Removed ${kind} ${name}.`);
  detail([["config", dim(path)]]);
  hint(`run \`${cmd("deploy")}\` to delete the live ${kind}`);
}

const removeService = defineCommand({
  meta: { name: "service", description: "Remove a service from the config" },
  args: removeArgs,
  async run({ args }) {
    const manifest = await loadConfig(args.config);
    if (!manifest.services[args.name]) {
      notFound("service", args.name, Object.keys(manifest.services));
    }
    await confirmRemoval("service", args.name, args.yes);
    const services = { ...manifest.services };
    delete services[args.name];
    const path = writeConfig({ ...manifest, services } satisfies Manifest, args.config);
    reportRemoved("service", args.name, path);
  },
});

const removeDatabase = defineCommand({
  meta: { name: "database", description: "Remove a database from the config" },
  args: removeArgs,
  async run({ args }) {
    const manifest = await loadConfig(args.config);
    if (!manifest.databases[args.name]) {
      notFound("database", args.name, Object.keys(manifest.databases));
    }
    await confirmRemoval("database", args.name, args.yes);
    const databases = { ...manifest.databases };
    delete databases[args.name];
    const path = writeConfig({ ...manifest, databases } satisfies Manifest, args.config);
    reportRemoved("database", args.name, path);
  },
});

const removeCompose = defineCommand({
  meta: { name: "compose", description: "Remove a compose stack from the config" },
  args: removeArgs,
  async run({ args }) {
    const manifest = await loadConfig(args.config);
    if (!manifest.composes[args.name]) {
      notFound("compose stack", args.name, Object.keys(manifest.composes));
    }
    await confirmRemoval("compose stack", args.name, args.yes);
    const composes = { ...manifest.composes };
    delete composes[args.name];
    const path = writeConfig({ ...manifest, composes } satisfies Manifest, args.config);
    reportRemoved("compose stack", args.name, path);
  },
});

export const removeCommand = defineCommand({
  meta: { name: "remove", description: "Remove a resource from the config file" },
  subCommands: {
    service: removeService,
    database: removeDatabase,
    compose: removeCompose,
  },
});
