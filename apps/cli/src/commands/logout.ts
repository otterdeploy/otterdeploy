import { defineCommand } from "citty";

import { clearConfig, loadConfig, normalizeUrl, tokenSource } from "../config";
import { revokeSession } from "../lib/revoke-session";
import { hint, ok, warn } from "../lib/ui";

export const logoutCommand = defineCommand({
  meta: {
    name: "logout",
    description: "Sign out: revoke this machine's session and clear the local credentials",
  },
  async run() {
    const config = loadConfig();
    const url = normalizeUrl(config.url);

    // Revoke on the server FIRST, then clear locally either way: a token that
    // only disappears from this machine stays valid for anyone holding a copy.
    if (config.token && url) {
      const revoked = await revokeSession(url, config.token);
      clearConfig();
      if (revoked.kind === "unreachable") {
        ok("Logged out on this machine.");
        warn(
          `The server session could not be revoked (${url}: ${revoked.reason}). It stays valid until it expires.`,
        );
      } else {
        ok("Logged out. The session was revoked on the server.");
      }
    } else {
      clearConfig();
      ok("Logged out.");
    }

    // A CI token in the environment is the caller's, not this machine's
    // login: logout neither revokes nor can clear it.
    if (tokenSource() === "env") {
      hint("OTTERDEPLOY_TOKEN is still set in this shell; unset it to stop using that token");
    }
  },
});
