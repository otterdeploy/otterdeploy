#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";

import { addCommand } from "./commands/add";
import { deployCommand } from "./commands/deploy";
import { envCommand } from "./commands/env";
import { exportCommand } from "./commands/export";
import { initCommand } from "./commands/init";
import { loginCommand } from "./commands/login";
import { logoutCommand } from "./commands/logout";
import { logsCommand } from "./commands/logs";
import { projectCommand } from "./commands/project";
import { pullCommand } from "./commands/pull";
import { whoamiCommand } from "./commands/whoami";

const main = defineCommand({
  meta: {
    name: "otterdeploy",
    version: "0.0.0",
    description: "CLI for otterdeploy",
  },
  subCommands: {
    login: loginCommand,
    logout: logoutCommand,
    whoami: whoamiCommand,
    init: initCommand,
    add: addCommand,
    deploy: deployCommand,
    pull: pullCommand,
    export: exportCommand,
    env: envCommand,
    logs: logsCommand,
    project: projectCommand,
  },
});

runMain(main);
