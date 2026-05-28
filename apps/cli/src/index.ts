#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";

import { loginCommand } from "./commands/login";
import { logoutCommand } from "./commands/logout";
import { projectCommand } from "./commands/project";
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
    project: projectCommand,
  },
});

runMain(main);
