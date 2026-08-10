import type { Manifest } from "@otterdeploy/api/manifest";

import { Result } from "better-result";
import { defineCommand } from "citty";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { configExists, loadConfig, writeConfig } from "../config-file";
import { cmd } from "../lib/name";
import { abort, confirm, detail, dim, ok, out, section, warn } from "../lib/ui";

// Only the key count of each section matters here, so `object` is the whole
// contract — any manifest section map satisfies it.
function countsOf(manifest: { services?: object; databases?: object; composes?: object }): string {
  const n = (record: object | undefined): number => Object.keys(record ?? {}).length;
  return `${n(manifest.services)} services ${dim("·")} ${n(manifest.databases)} databases ${dim("·")} ${n(manifest.composes)} composes`;
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
      abort(
        localError ? `Local config is unreadable: ${localError.message}` : "No project to pull.",
        "pass `--slug <slug>` to pull anyway",
      );
    }

    const project = await client.project.getBySlug({ slug });
    const { manifest } = await client.project.manifest.get({ id: project.id });
    if (!manifest) {
      abort(
        "Server has no manifest saved for this project yet.",
        `run \`${cmd("deploy")}\` to publish the local config first`,
      );
    }

    if (hasLocal && !args.yes) {
      if (!process.stdin.isTTY) {
        abort(
          "Refusing to overwrite the existing config non-interactively.",
          "pass `--yes` if you are certain",
        );
      }
      // Show both sides before overwriting — the counts are what tell you
      // whether you are about to lose local work.
      section("Overwrite local config");
      detail([
        ["local", localManifest ? countsOf(localManifest) : dim("unreadable")],
        ["server", countsOf(manifest)],
      ]);
      out();
      warn("The local file is replaced wholesale. Uncommitted edits are lost.");
      if (!(await confirm("Overwrite the local config?"))) {
        abort("Aborted — the local config was left untouched.");
      }
    }

    const path = writeConfig(manifest, args.config);
    ok(`Wrote ${path}`);
  },
});
