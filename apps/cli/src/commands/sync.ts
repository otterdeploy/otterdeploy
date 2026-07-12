import { defineCommand } from "citty";

import { parseTimeoutMinutes, runDeploy } from "../lib/deploy-run";

export const syncCommand = defineCommand({
  meta: {
    name: "sync",
    description: "Save the local config and reconcile resources (same operation as deploy)",
  },
  args: {
    config: { type: "string", description: "Path to config file" },
    env: { type: "string", description: "Environment override block to apply" },
    "dry-run": { type: "boolean", description: "Show the change plan without applying" },
    preview: { type: "boolean", description: "Alias of --dry-run" },
    wait: { type: "boolean", description: "Wait for changed services to reach running" },
    timeout: { type: "string", description: "Minutes to wait with --wait (default 30)" },
    yes: { type: "boolean", description: "Skip confirmation prompts" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    await runDeploy({
      config: args.config,
      env: args.env,
      url: args.url,
      dryRun: args["dry-run"] || args.preview,
      yes: args.yes,
      json: args.json,
      wait: args.wait,
      timeoutMinutes: parseTimeoutMinutes(args.timeout),
    });
  },
});
