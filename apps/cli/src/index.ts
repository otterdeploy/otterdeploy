#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";

import { deployCommand } from "./commands/deploy";
import { envCommand } from "./commands/env";
import { initCommand } from "./commands/init";
import { loginCommand } from "./commands/login";
import { logoutCommand } from "./commands/logout";
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
    deploy: deployCommand,
    pull: pullCommand,
    env: envCommand,
    project: projectCommand,
  },
});

runMain(main);
