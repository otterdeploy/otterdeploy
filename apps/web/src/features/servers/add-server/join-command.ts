/**
 * The one-time install command for a new server:
 *
 *   curl -fsSL https://<control-plane>/install-node.sh \
 *     | sudo sh -s -- --token <token>
 *
 * The control plane serves `install-node.sh` (public, no secret); it redeems
 * the token and runs the installer that comes back. The command is pasted
 * into a shell on a DIFFERENT machine, so it carries the control plane's
 * address, never this browser's incidental one.
 *
 * What is shown is exactly what Copy writes (bar the masked token), and the
 * line break is one the shell accepts.
 */

export interface CreatedCommand {
  id: string;
  credential: string;
  expiresAt: string;
}

export function buildJoinCommand(baseUrl: string, created: CreatedCommand): string {
  return [
    `curl -fsSL ${baseUrl}/install-node.sh \\`,
    `  | sudo sh -s -- --token ${created.credential}`,
  ].join("\n");
}

/** Characters of the token left readable while it is masked. */
const TOKEN_VISIBLE = 8;

/** The token as shown before Reveal: enough to recognise, not enough to use. */
export function maskToken(token: string): string {
  return `${token.slice(0, TOKEN_VISIBLE)}${"•".repeat(12)}`;
}
