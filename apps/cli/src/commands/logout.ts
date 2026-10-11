import { defineCommand } from "citty";

import { clearConfig, listContexts, resolveUrl, tokenSource } from "../config";
import { revokeSession } from "../lib/revoke-session";
import { abort, hint, ok, warn } from "../lib/ui";

/**
 * Sign out of one control plane: revoke its session on the server FIRST, then
 * forget it locally either way. A token that only disappears from this machine
 * stays valid for anyone holding a copy.
 *
 * Shared with `context remove`, which is the same act under another name.
 */
export async function signOutOf(url: string): Promise<void> {
  const token = listContexts().find((c) => c.url === url)?.context.token;
  if (!token) {
    clearConfig(url);
    ok(`Logged out of ${url}.`);
    return;
  }
  const revoked = await revokeSession(url, token);
  clearConfig(url);
  if (revoked.kind === "unreachable") {
    ok(`Logged out of ${url} on this machine.`);
    warn(
      `The server session could not be revoked (${url}: ${revoked.reason}). It stays valid until it expires.`,
    );
    return;
  }
  ok(`Logged out of ${url}. The session was revoked on the server.`);
}

export const logoutCommand = defineCommand({
  meta: {
    name: "logout",
    description: "Sign out of a control plane: revoke its session and clear its credentials",
  },
  args: {
    url: { type: "string", description: "Control plane to sign out of" },
    all: { type: "boolean", description: "Sign out of every control plane" },
  },
  async run({ args }) {
    if (args.all) {
      const contexts = listContexts();
      if (contexts.length === 0) {
        clearConfig();
        ok("Logged out.");
      }
      // One at a time so each host's outcome is reported against its name.
      for (const { url } of contexts) await signOutOf(url);
    } else {
      // One host, because signing out of the one you are looking at should
      // not cost you the others you are signed into.
      const url = resolveUrl(args.url);
      if (!url) abort("Not logged in to anything.");
      await signOutOf(url);
    }

    // A CI token in the environment is the caller's, not this machine's
    // login: logout neither revokes nor can clear it.
    if (tokenSource() === "env") {
      hint("OTTERDEPLOY_TOKEN is still set in this shell; unset it to stop using that token");
    }
  },
});
