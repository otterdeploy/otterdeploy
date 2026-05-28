import { defineCommand } from "citty";
import { consola } from "consola";

import { clearConfig } from "../config";

export const logoutCommand = defineCommand({
  meta: {
    name: "logout",
    description: "Clear the local credentials",
  },
  async run() {
    clearConfig();
    consola.success("Logged out.");
  },
});
