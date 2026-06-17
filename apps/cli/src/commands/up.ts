/**
 * `up` — zero-to-deployed in one command.
 *
 *   no config yet?  create/link the project, scaffold a config, optionally
 *                   define a first service, then deploy.
 *   config exists?  just deploy it (idempotent — re-run to redeploy).
 *
 * The deploy half is identical to `sync`: save + diff to show the plan,
 * confirm if anything is destructive, then the atomic `applyChange` the
 * UI Deploy button uses. `init` + `deploy` still exist for users who want
 * the two steps apart; `up` is the guided fast path.
 */

import { existsSync } from "node:fs";
import { basename } from "node:path";

import { defineCommand } from "citty";
import { consola } from "consola";

import type { Manifest } from "@otterdeploy/api/manifest";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { loadConfig as loadCliConfig } from "../config";
import {
  configExists,
  configPath,
  loadConfig as loadManifest,
  writeConfig,
  writeConfigTemplate,
} from "../config-file";
import { countByKind, printDiff } from "../lib/diff-printer";

// Project slugs are lowercase kebab; derive a sane default from the cwd.
function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "app"
  );
}

export const upCommand = defineCommand({
  meta: {
    name: "up",
    description: "Scaffold (if needed) and deploy in one step",
  },
  args: {
    config: { type: "string", description: "Path to config file" },
    env: { type: "string", description: "Environment override block to apply" },
    name: { type: "string", description: "Project display name (scaffold only)" },
    slug: { type: "string", description: "Project slug (scaffold only)" },
    yes: { type: "boolean", description: "Skip all prompts (non-interactive)" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });

    const targetPath = configPath(args.config);
    const haveConfig = args.config ? existsSync(targetPath) : configExists();

    // ─── Scaffold (only when there's no config yet) ───────────────────
    if (!haveConfig) {
      const defaultSlug = slugify(basename(process.cwd()));
      const slug =
        args.slug ??
        (args.yes || args.json
          ? defaultSlug
          : await consola.prompt("Project slug:", {
              type: "text",
              initial: defaultSlug,
              default: defaultSlug,
            }));
      const name = args.name ?? slug;

      // create, or link if the slug is already taken (same as `init`).
      let project: { id: string; slug: string };
      try {
        project = await client.project.create({ name, slug });
        consola.success(`Created project ${slug}`);
      } catch (error) {
        if ((error as { code?: string }).code !== "CONFLICT") throw error;
        project = await client.project.getBySlug({ slug });
        consola.info(`Linked to existing project ${slug}`);
      }

      // $schema lives on the web origin (captured at login), not the API.
      const schemaHost = loadCliConfig().webUrl ?? url;
      writeConfigTemplate({
        path: targetPath,
        schemaUrl: `${schemaHost.replace(/\/$/, "")}/otterdeploy.schema.json`,
        projectSlug: project.slug,
      });
      consola.success(`Wrote ${targetPath}`);

      // A bare template deploys nothing useful — offer a first service.
      if (!args.yes && !args.json) {
        await maybeAddFirstService(args.config);
      }
    }

    // ─── Deploy (same path as `sync`) ─────────────────────────────────
    const manifest = await loadManifest(args.config);
    const project = await client.project.getBySlug({ slug: manifest.project });
    const current = await client.project.manifest.get({ id: project.id });

    // Save + diff so the plan reflects the local manifest (diff compares
    // the *saved* manifest vs live state). applyChange then uses the
    // bumped version.
    const saved = await client.project.manifest.save({
      projectId: project.id,
      manifest,
      expectedVersion: current.version,
    });
    const diff = await client.project.manifest.diff({
      projectId: project.id,
      environment: args.env,
    });

    if (diff.changes.length === 0) {
      if (args.json) {
        process.stdout.write(
          `${JSON.stringify({ appliedCount: 0, skipped: [], version: saved.version }, null, 2)}\n`,
        );
        return;
      }
      consola.info("Nothing to deploy — already in sync.");
      return;
    }

    if (!args.yes && !args.json) {
      printDiff(diff.changes);
      const counts = countByKind(diff.changes);
      const deletes = counts.delete ?? 0;
      const ok = await consola.prompt(
        deletes > 0 ? `${deletes} resource(s) will be deleted. Continue?` : "Apply these changes?",
        { type: "confirm", initial: deletes === 0 },
      );
      if (!ok) {
        consola.info("Aborted. Config saved — run `otterdeploy deploy` when ready.");
        return;
      }
    }

    const result = await client.project.manifest.applyChange({
      projectId: project.id,
      manifest,
      expectedVersion: saved.version,
      environment: args.env,
    });

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    consola.success(`Applied ${result.appliedCount} change(s) (manifest v${result.version}).`);
    if (result.skipped.length > 0) {
      consola.warn("Skipped:");
      for (const s of result.skipped) {
        consola.log(`  ${s.resource} ${s.name}: ${s.reason}`);
      }
      process.exitCode = 1;
    }
  },
});

// Interactive first-service builder. Mirrors `add service`'s manifest
// shape; skipped entirely in non-interactive mode.
async function maybeAddFirstService(configOverride?: string): Promise<void> {
  const wants = await consola.prompt("Add a service now?", { type: "confirm", initial: true });
  if (!wants) return;

  const name = (await consola.prompt("Service name:", {
    type: "text",
    initial: "web",
    default: "web",
  })) as string;

  const source = (await consola.prompt("Source:", {
    type: "select",
    options: [
      { label: "Container image", value: "image" },
      { label: "Build from this project's git repo", value: "git" },
    ],
  })) as "image" | "git";

  const portRaw = (await consola.prompt("HTTP port (blank to skip):", {
    type: "text",
    initial: "3000",
    default: "3000",
  })) as string;
  const portNum = portRaw ? Number.parseInt(portRaw, 10) : undefined;
  const hasPort = portNum !== undefined && Number.isFinite(portNum);

  const manifest = await loadManifest(configOverride);
  const next: Manifest = { ...manifest, services: { ...manifest.services } };

  if (source === "git") {
    const subdir = (await consola.prompt("Build subdir (blank for repo root):", {
      type: "text",
    })) as string;
    next.services[name] = {
      source: "git",
      sourceSubdir: subdir || null,
      replicas: 1,
      ...(hasPort ? { ports: [{ container: portNum, appProtocol: "http", primary: true }] } : {}),
    };
  } else {
    const image = (await consola.prompt("Container image (e.g. ghcr.io/org/app:latest):", {
      type: "text",
    })) as string;
    if (!image) {
      consola.warn("No image given — skipping service. Edit the config and run `otterdeploy deploy`.");
      return;
    }
    next.services[name] = {
      source: "image",
      image,
      replicas: 1,
      ...(hasPort ? { ports: [{ container: portNum, appProtocol: "http", primary: true }] } : {}),
    };
  }

  const path = writeConfig(next, configOverride);
  consola.success(`Added service ${name} to ${path}.`);
}
