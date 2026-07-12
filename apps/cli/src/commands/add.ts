import type { Manifest } from "@otterdeploy/api/manifest";

import { defineCommand } from "citty";
import { consola } from "consola";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadConfig, writeConfig } from "../config-file";

type ServiceEntry = Manifest["services"][string];

// citty keeps only the last value of a repeated string flag, so repeatable
// flags (--domain, --env, --expose) are re-collected from rawArgs.
function collectFlag(rawArgs: string[], flag: string): string[] {
  const long = `--${flag}`;
  const out: string[] = [];
  let pending = false;
  for (const arg of rawArgs) {
    if (pending) {
      out.push(arg);
      pending = false;
    } else if (arg === long) {
      pending = true;
    } else if (arg.startsWith(`${long}=`)) {
      out.push(arg.slice(long.length + 1));
    }
  }
  return out;
}

function parseEnvPairs(values: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of values) {
    const idx = pair.indexOf("=");
    const key = idx > 0 ? pair.slice(0, idx) : "";
    if (!key) {
      consola.error(`--env expects KEY=VAL, got: ${pair}`);
      process.exit(1);
    }
    out[key] = pair.slice(idx + 1);
  }
  return out;
}

function parseExpose(spec: string): { service: string; port: number; domain?: string } {
  const [service, portRaw, domain, ...rest] = spec.split(":");
  if (!service || !portRaw || !/^\d+$/.test(portRaw) || rest.length > 0) {
    consola.error(`--expose expects service:port[:domain], got: ${spec}`);
    process.exit(1);
  }
  const port = Number.parseInt(portRaw, 10);
  if (port <= 0) {
    consola.error(`--expose port must be positive, got: ${spec}`);
    process.exit(1);
  }
  return { service, port, ...(domain ? { domain } : {}) };
}

const addService = defineCommand({
  meta: { name: "service", description: "Add a service to the config" },
  args: {
    name: { type: "positional", required: true, description: "Service name" },
    image: { type: "string", description: "Container image (for source=image)" },
    git: { type: "boolean", description: "Source from project's git binding instead" },
    upload: {
      type: "boolean",
      description: "Build from this local directory, uploaded on `deploy` (no git)",
    },
    repo: { type: "string", description: 'Git repo as "owner/name" (with --git)' },
    branch: { type: "string", description: "Branch whose pushes deploy (with --git)" },
    "source-subdir": { type: "string", description: "Build path within the git repo" },
    port: { type: "string", description: "Container port (HTTP, primary)" },
    replicas: { type: "string", description: "Replica count" },
    domain: { type: "string", description: "Public domain — first is primary (repeatable)" },
    env: { type: "string", description: "Env var KEY=VAL (repeatable)" },
    config: { type: "string", description: "Path to config file" },
  },
  async run({ args, rawArgs }) {
    const manifest = await loadConfig(args.config);
    if (manifest.services[args.name]) {
      consola.error(`Service ${args.name} already exists.`);
      process.exit(1);
    }

    if (args.upload && args.git) {
      consola.error("--upload and --git are mutually exclusive — pick one source.");
      process.exit(1);
    }
    if ((args.repo || args.branch) && !args.git) {
      consola.error("--repo/--branch only apply to git services — pass --git as well.");
      process.exit(1);
    }
    if (args.repo) {
      const parts = args.repo.split("/");
      if (parts.length !== 2 || parts.some((p) => !p)) {
        consola.error(`--repo must be "owner/name", got: ${args.repo}`);
        process.exit(1);
      }
    }

    const replicas = args.replicas ? Number.parseInt(args.replicas, 10) : 1;
    const portNum = args.port ? Number.parseInt(args.port, 10) : undefined;
    const domains = collectFlag(rawArgs, "domain");
    const env = parseEnvPairs(collectFlag(rawArgs, "env"));

    const common: Pick<ServiceEntry, "replicas" | "ports" | "env" | "domains"> = {
      replicas,
      ...(portNum ? { ports: [{ container: portNum, appProtocol: "http", primary: true }] } : {}),
      ...(domains.length > 0
        ? {
            domains: domains.map((domain, i) => ({
              domain,
              ...(i === 0 ? { primary: true } : {}),
            })),
          }
        : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };

    const next: Manifest = {
      ...manifest,
      services: { ...manifest.services },
    };

    if (args.upload) {
      next.services[args.name] = {
        source: "upload",
        sourceSubdir: args["source-subdir"] ?? null,
        ...common,
      };
    } else if (args.git) {
      next.services[args.name] = {
        source: "git",
        ...(args.repo ? { repo: args.repo } : {}),
        ...(args.branch ? { branch: args.branch } : {}),
        sourceSubdir: args["source-subdir"] ?? null,
        ...common,
      };
    } else {
      if (!args.image) {
        consola.error("--image is required (or pass --git to build from the project's repo)");
        process.exit(1);
      }
      next.services[args.name] = {
        source: "image",
        image: args.image,
        ...common,
      };
    }

    const path = writeConfig(next, args.config);
    consola.success(
      `Added service ${args.name}. Edit ${path} to refine, then \`otterdeploy deploy\`.`,
    );
  },
});

const addDatabase = defineCommand({
  meta: { name: "database", description: "Add a database to the config" },
  args: {
    name: { type: "positional", required: true, description: "Database name (your choice)" },
    engine: {
      type: "string",
      required: true,
      description: "Engine: postgres | redis | mariadb | mongodb",
    },
    version: { type: "string", description: "Engine version (optional)" },
    "public-enabled": {
      type: "boolean",
      description: "Expose publicly (postgres only today)",
    },
    config: { type: "string", description: "Path to config file" },
  },
  async run({ args }) {
    const manifest = await loadConfig(args.config);
    if (manifest.databases[args.name]) {
      consola.error(`Database ${args.name} already exists.`);
      process.exit(1);
    }
    const engine = args.engine as "postgres" | "redis" | "mariadb" | "mongodb";
    if (!["postgres", "redis", "mariadb", "mongodb"].includes(engine)) {
      consola.error(`Unknown engine: ${args.engine}`);
      process.exit(1);
    }

    const next: Manifest = {
      ...manifest,
      databases: { ...manifest.databases },
    };
    next.databases[args.name] = {
      engine,
      ...(args.version ? { version: args.version } : {}),
      ...(args["public-enabled"] ? { publicEnabled: true } : {}),
    } as Manifest["databases"][string];

    const path = writeConfig(next, args.config);
    consola.success(
      `Added database ${args.name} (${engine}). Edit ${path} and \`otterdeploy deploy\`.`,
    );
  },
});

const addCompose = defineCommand({
  meta: { name: "compose", description: "Add a compose stack to the config" },
  args: {
    name: { type: "positional", required: true, description: "Stack name" },
    file: { type: "string", description: "Local compose file to inline (source=inline)" },
    "git-url": { type: "string", description: "HTTPS repo URL with the compose file (source=git)" },
    "git-ref": { type: "string", description: "Git ref — branch/tag/sha (with --git-url)" },
    "compose-path": {
      type: "string",
      description: "Compose file path in the repo (with --git-url)",
    },
    expose: { type: "string", description: "Expose service:port[:domain] publicly (repeatable)" },
    env: { type: "string", description: "Seed env var KEY=VAL for ${VAR} refs (repeatable)" },
    config: { type: "string", description: "Path to config file" },
  },
  async run({ args, rawArgs }) {
    const manifest = await loadConfig(args.config);
    if (manifest.composes[args.name]) {
      consola.error(`Compose stack ${args.name} already exists.`);
      process.exit(1);
    }

    const gitUrl = args["git-url"];
    if ((args.file ? 1 : 0) + (gitUrl ? 1 : 0) !== 1) {
      consola.error("Pass exactly one of --file <path> or --git-url <https url>.");
      process.exit(1);
    }
    if (!gitUrl && (args["git-ref"] || args["compose-path"])) {
      consola.error("--git-ref/--compose-path only apply with --git-url.");
      process.exit(1);
    }

    const env = parseEnvPairs(collectFlag(rawArgs, "env"));
    const exposed = collectFlag(rawArgs, "expose").map(parseExpose);
    const extras = {
      ...(Object.keys(env).length > 0 ? { env } : {}),
      ...(exposed.length > 0 ? { exposed } : {}),
    };

    const next: Manifest = {
      ...manifest,
      composes: { ...manifest.composes },
    };

    if (args.file) {
      const filePath = resolve(args.file);
      if (!existsSync(filePath)) {
        consola.error(`File not found: ${filePath}`);
        process.exit(1);
      }
      const content = readFileSync(filePath, "utf8");
      if (!content.trim()) {
        consola.error(`Compose file is empty: ${filePath}`);
        process.exit(1);
      }
      next.composes[args.name] = { source: "inline", content, ...extras };
    } else if (gitUrl) {
      if (!/^https?:\/\//.test(gitUrl)) {
        consola.error(`--git-url must be an http(s) URL, got: ${gitUrl}`);
        process.exit(1);
      }
      next.composes[args.name] = {
        source: "git",
        gitRepoUrl: gitUrl,
        ...(args["git-ref"] ? { gitRef: args["git-ref"] } : {}),
        ...(args["compose-path"] ? { composePath: args["compose-path"] } : {}),
        ...extras,
      };
    }

    const path = writeConfig(next, args.config);
    consola.success(
      `Added compose stack ${args.name}. Edit ${path} to refine, then \`otterdeploy deploy\`.`,
    );
  },
});

export const addCommand = defineCommand({
  meta: { name: "add", description: "Append a resource to the config file" },
  subCommands: {
    service: addService,
    database: addDatabase,
    compose: addCompose,
  },
});
