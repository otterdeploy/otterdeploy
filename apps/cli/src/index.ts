#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";

import { destroyCommand } from "./commands/destroy";
import { initCommand } from "./commands/init";
import { previewCommand } from "./commands/preview";
import { statusCommand } from "./commands/status";
import { syncCommand } from "./commands/sync";

const main = defineCommand({
  meta: {
    name: "otterdeploy",
    version: "0.0.0",
    description:
      "Declarative CLI for otterdeploy. Define your project in otterdeploy.config.ts, then sync.",
  },
  subCommands: {
    init: initCommand,
    sync: syncCommand,
    preview: previewCommand,
    status: statusCommand,
    destroy: destroyCommand,
  },
});

runMain(main);
