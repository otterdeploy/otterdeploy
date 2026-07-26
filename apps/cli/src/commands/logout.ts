import { defineCommand } from "citty";

import { clearConfig } from "../config";
import { ok } from "../lib/ui";

export const logoutCommand = defineCommand({
  meta: {
    name: "logout",
    description: "Clear the local credentials",
  },
  async run() {
    clearConfig();
    ok("Logged out.");
  },
});
