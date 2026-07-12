import type { Manifest } from "@otterdeploy/api/manifest";

import { Result } from "better-result";
import { defineCommand } from "citty";
import { consola } from "consola";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { configExists, loadConfig, writeConfig } from "../config-file";

function countsOf(manifest: {
  services?: Record<string, unknown>;
  databases?: Record<string, unknown>;
  composes?: Record<string, unknown>;
}): string {
  const n = (record: Record<string, unknown> | undefined): number =>
    Object.keys(record ?? {}).length;
  return `${n(manifest.services)} services, ${n(manifest.databases)} databases, ${n(manifest.composes)} composes`;
}

export const pullCommand = defineCommand({
  meta: {
    name: "pull",
    description: "Overwrite the local config with the server's manifest",
  },
  args: {
    config: { type: "string", description: "Path to config file" },
    slug: {
      type: "string",
      description: "Project slug (defaults to the slug in the local file)",
    },
    url: { type: "string", description: "Override control plane URL" },
    yes: { type: "boolean", description: "Overwrite an existing config file without asking" },
  },
  async run({ args }) {
    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });

    // An unparseable local file is a legitimate reason to pull, so its load
    // failure only matters where the content was needed (slug fallback and
    // the overwrite summary) — it must not abort the pull itself.
    const hasLocal = configExists(args.config);
    let localManifest: Manifest | null = null;
    let localError: Error | null = null;
    if (hasLocal) {
      const loaded = await Result.tryPromise({
        try: () => loadConfig(args.config),
        catch: (cause): Error => (cause instanceof Error ? cause : new Error(String(cause))),
      });
      if (loaded.isOk()) localManifest = loaded.value;
      else localError = loaded.error;
    }

    const slug = args.slug ?? localManifest?.project ?? null;
    if (!slug) {
      consola.error(
        localError
          ? `Local config is unreadable (${localError.message}). Pass --slug to pull anyway.`
          : "No --slug provided and no local config to read it from.",
      );
      process.exit(1);
    }

    const project = await client.project.getBySlug({ slug });
    const { manifest } = await client.project.manifest.get({ id: project.id });
    if (!manifest) {
      consola.error("Server has no manifest saved yet for this project.");
      process.exit(1);
    }

    if (hasLocal && !args.yes) {
      if (!process.stdin.isTTY) {
        consola.error("Refusing to overwrite the existing config non-interactively. Pass --yes.");
        process.exit(1);
      }
      const localCounts = localManifest ? countsOf(localManifest) : "unreadable";
      consola.info(`Local: ${localCounts} — server: ${countsOf(manifest)}.`);
      const confirmed = await consola.prompt("Overwrite the local config?", {
        type: "confirm",
        initial: false,
      });
      if (confirmed !== true) {
        consola.error("Aborted — local config left untouched.");
        process.exit(1);
      }
    }

    const path = writeConfig(manifest, args.config);
    consola.success(`Wrote ${path}`);
  },
});
