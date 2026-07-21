import { defineCommand } from "citty";
import { consola } from "consola";

import { resolveResource } from "../lib/resolve";

const listVolumes = defineCommand({
  meta: { name: "list", description: "List persistent volumes on a service" },
  args: {
    service: { type: "string", required: true, description: "Service name" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const { client, projectId, resourceId } = await resolveResource(args, args.service, "service");
    const rows = await client.service.mounts.list({ projectId, resourceId });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      return;
    }
    if (rows.length === 0) {
      consola.info(
        `No volumes on ${args.service}. Add one with \`volume add --service ${args.service} --mount-path /data\`.`,
      );
      return;
    }
    const width = Math.max(...rows.map((r) => r.mountPath.length));
    for (const r of rows) {
      const ro = r.readOnly ? "  (read-only)" : "";
      consola.log(`  ${r.mountPath.padEnd(width)}  →  ${r.volumeName}${ro}`);
    }
  },
});

const addVolume = defineCommand({
  meta: { name: "add", description: "Attach a persistent volume to a service" },
  args: {
    service: { type: "string", required: true, description: "Service name" },
    "mount-path": {
      type: "string",
      required: true,
      description: "Absolute container path to mount (e.g. /data)",
    },
    "read-only": { type: "boolean", description: "Mount the volume read-only" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const ctx = await resolveResource(args, args.service, "service");
    const row = await ctx.client.service.mounts.add({
      projectId: ctx.projectId,
      resourceId: ctx.resourceId,
      mountPath: args["mount-path"],
      readOnly: args["read-only"] ? true : undefined,
    });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(row, null, 2)}\n`);
      return;
    }
    consola.success(`Attached ${row.mountPath} to ${ctx.resourceName} (volume ${row.volumeName}).`);
    consola.info("The service is redeploying to mount it. Data persists across future deploys.");
  },
});

const removeVolume = defineCommand({
  meta: {
    name: "remove",
    description: "Detach a persistent volume from a service (its data is left intact)",
  },
  args: {
    service: { type: "string", required: true, description: "Service name" },
    "mount-path": {
      type: "string",
      required: true,
      description: "Absolute container path of the volume to detach",
    },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    yes: { type: "boolean", description: "Skip confirmation prompts" },
  },
  async run({ args }) {
    const ctx = await resolveResource(args, args.service, "service");
    const mountPath = args["mount-path"];
    if (!args.yes) {
      const ok = await consola.prompt(
        `Detach ${mountPath} from ${ctx.resourceName}? The volume's data is kept, but the container will no longer see it.`,
        { type: "confirm", initial: false },
      );
      if (!ok) {
        consola.info("Aborted.");
        process.exit(1);
      }
    }
    await ctx.client.service.mounts.remove({
      projectId: ctx.projectId,
      resourceId: ctx.resourceId,
      mountPath,
    });
    consola.success(`Detached ${mountPath} from ${ctx.resourceName}.`);
  },
});

export const volumeCommand = defineCommand({
  meta: { name: "volume", description: "Manage a service's persistent volumes" },
  subCommands: {
    list: listVolumes,
    add: addVolume,
    remove: removeVolume,
  },
});
