/**
 * Which log a deployment's "View logs" should open: the panel's Logs tab
 * shows a SOURCE, and this picks it.
 *
 * The choice is "where is the output right now":
 *  - still building, or never got past it → the build log is the live stream
 *  - failed → the build log, which is where the reason almost always is; a
 *    deploy that died in its container still shows that log's tail there
 *  - otherwise → deploy logs, the running container's own output
 *
 * Every entry point shares this so they cannot drift: the deployment card, the
 * history row menu, and the row's own View-logs button.
 */

export function logSourceForStatus(status: string | null | undefined): "build" | "deploy" {
  switch (status) {
    case "pending":
    case "building":
    case "failed":
    case "crashed":
    case "cancelled":
      return "build";
    default:
      return "deploy";
  }
}
