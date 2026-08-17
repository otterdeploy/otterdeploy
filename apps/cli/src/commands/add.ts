import type { Manifest } from "@otterdeploy/api/manifest";

import { defineCommand } from "citty";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadConfig, writeConfig } from "../config-file";
import { cmd } from "../lib/name";
import { abort, detail, dim, hint, ok } from "../lib/ui";

type ServiceEntry = Manifest["services"][string];

const DB_ENGINES = ["postgres", "redis", "mariadb", "mongodb"] as const;

/** Narrow a raw --engine flag to a supported engine without asserting. */
function parseEngine(value: string): (typeof DB_ENGINES)[number] | undefined {
  return DB_ENGINES.find((engine) => engine === value);
}

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
      abort(`--env expects KEY=VAL, got: ${pair}`);
    }
    out[key] = pair.slice(idx + 1);
  }
  return out;
}

function parseExpose(spec: string): { service: string; port: number; domain?: string } {
  const [service, portRaw, domain, ...rest] = spec.split(":");
  if (!service || !portRaw || !/^\d+$/.test(portRaw) || rest.length > 0) {
    abort(`--expose expects service:port[:domain], got: ${spec}`);
  }
  const port = Number.parseInt(portRaw, 10);
  if (port <= 0) {
    abort(`--expose port must be positive, got: ${spec}`);
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
    domain: { type: "string", description: "Public domain; first is primary (repeatable)" },
    env: { type: "string", description: "Env var KEY=VAL (repeatable)" },
    config: { type: "string", description: "Path to config file" },
  },
  async run({ args, rawArgs }) {
    const manifest = await loadConfig(args.config);
    if (manifest.services[args.name]) {
      abort(`Service ${args.name} already exists.`);
    }

    if (args.upload && args.git) {
      abort("--upload and --git are mutually exclusive. Pick one source.");
    }
    if ((args.repo || args.branch) && !args.git) {
      abort("--repo/--branch only apply to git services. Pass --git as well.");
    }
    if (args.repo) {
      const parts = args.repo.split("/");
      if (parts.length !== 2 || parts.some((p) => !p)) {
        abort(`--repo must be "owner/name", got: ${args.repo}`);
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
        abort("--image is required (or pass --git to build from the project's repo)");
      }
      next.services[args.name] = {
        source: "image",
        image: args.image,
        ...common,
      };
    }

    const path = writeConfig(next, args.config);
    ok(`Added service ${args.name}.`);
    detail([["config", dim(path)]]);
    hint(`edit the file to refine it, then run \`${cmd("deploy")}\``);
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
      abort(`Database ${args.name} already exists.`);
    }
    const engine = parseEngine(args.engine);
    if (!engine) {
      abort(`Unknown engine: ${args.engine}`);
    }

    const next: Manifest = {
      ...manifest,
      databases: { ...manifest.databases },
    };
    const entry: Manifest["databases"][string] = {
      engine,
      ...(args.version ? { version: args.version } : {}),
      ...(args["public-enabled"] ? { publicEnabled: true } : {}),
    };
    next.databases[args.name] = entry;

    const path = writeConfig(next, args.config);
    ok(`Added database ${args.name}.`);
    detail([
      ["engine", engine],
      ["config", dim(path)],
    ]);
    hint(`run \`${cmd("deploy")}\` to provision it`);
  },
});

const addCompose = defineCommand({
  meta: { name: "compose", description: "Add a compose stack to the config" },
  args: {
    name: { type: "positional", required: true, description: "Stack name" },
    file: { type: "string", description: "Local compose file to inline (source=inline)" },
    "git-url": { type: "string", description: "HTTPS repo URL with the compose file (source=git)" },
    "git-ref": { type: "string", description: "Git ref: branch/tag/sha (with --git-url)" },
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
      abort(`Compose stack ${args.name} already exists.`);
    }

    const gitUrl = args["git-url"];
    if ((args.file ? 1 : 0) + (gitUrl ? 1 : 0) !== 1) {
      abort("Pass exactly one of --file <path> or --git-url <https url>.");
    }
    if (!gitUrl && (args["git-ref"] || args["compose-path"])) {
      abort("--git-ref/--compose-path only apply with --git-url.");
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
        abort(`File not found: ${filePath}`);
      }
      const content = readFileSync(filePath, "utf8");
      if (!content.trim()) {
        abort(`Compose file is empty: ${filePath}`);
      }
      next.composes[args.name] = { source: "inline", content, ...extras };
    } else if (gitUrl) {
      if (!/^https?:\/\//.test(gitUrl)) {
        abort(`--git-url must be an http(s) URL, got: ${gitUrl}`);
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
    ok(`Added compose stack ${args.name}.`);
    detail([["config", dim(path)]]);
    hint(`edit the file to refine it, then run \`${cmd("deploy")}\``);
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
