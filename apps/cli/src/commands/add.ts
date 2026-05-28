import { defineCommand } from "citty";
import { consola } from "consola";

import type { Manifest } from "@otterdeploy/api/manifest";

import { loadConfig, writeConfig } from "../config-file";

const addService = defineCommand({
  meta: { name: "service", description: "Add a service to the config" },
  args: {
    name: { type: "positional", required: true, description: "Service name" },
    image: { type: "string", description: "Container image (for source=image)" },
    git: { type: "boolean", description: "Source from project's git binding instead" },
    "source-subdir": { type: "string", description: "Build path within the git repo" },
    port: { type: "string", description: "Container port (HTTP, primary)" },
    replicas: { type: "string", description: "Replica count" },
    config: { type: "string", description: "Path to config file" },
  },
  async run({ args }) {
    const manifest = await loadConfig(args.config);
    if (manifest.services[args.name]) {
      consola.error(`Service ${args.name} already exists.`);
      process.exit(1);
    }

    const replicas = args.replicas ? Number.parseInt(args.replicas, 10) : 1;
    const portNum = args.port ? Number.parseInt(args.port, 10) : undefined;

    const next: Manifest = {
      ...manifest,
      services: { ...manifest.services },
    };

    if (args.git) {
      next.services[args.name] = {
        source: "git",
        sourceSubdir: args["source-subdir"] ?? null,
        replicas,
        ...(portNum
          ? { ports: [{ container: portNum, appProtocol: "http", primary: true }] }
          : {}),
      };
    } else {
      if (!args.image) {
        consola.error("--image is required (or pass --git to build from the project's repo)");
        process.exit(1);
      }
      next.services[args.name] = {
        source: "image",
        image: args.image,
        replicas,
        ...(portNum
          ? { ports: [{ container: portNum, appProtocol: "http", primary: true }] }
          : {}),
      };
    }

    const path = writeConfig(next, args.config);
    consola.success(`Added service ${args.name}. Edit ${path} to refine, then \`otterdeploy deploy\`.`);
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
    consola.success(`Added database ${args.name} (${engine}). Edit ${path} and \`otterdeploy deploy\`.`);
  },
});

export const addCommand = defineCommand({
  meta: { name: "add", description: "Append a resource to the config file" },
  subCommands: {
    service: addService,
    database: addDatabase,
  },
});
