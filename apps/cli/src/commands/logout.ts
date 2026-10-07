import { defineCommand } from "citty";

import { clearConfig, resolveUrl } from "../config";
import { abort, ok } from "../lib/ui";

export const logoutCommand = defineCommand({
  meta: {
    name: "logout",
    description: "Clear the credentials for a control plane",
  },
  args: {
    url: { type: "string", description: "Control plane to sign out of" },
    all: { type: "boolean", description: "Sign out of every control plane" },
  },
  run({ args }) {
    if (args.all) {
      clearConfig();
      ok("Logged out of every control plane.");
      return;
    }
    // One host, because signing out of the one you are looking at should not
    // cost you the others you are signed into.
    const url = resolveUrl(args.url);
    if (!url) abort("Not logged in to anything.");
    clearConfig(url);
    ok(`Logged out of ${url}.`);
  },
});
