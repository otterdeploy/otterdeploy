/**
 * Which tab "View logs" should open for a deployment.
 *
 * It used to open Details for anything that hadn't failed, so the control
 * labelled "View logs" showed the overview and left you to find the logs
 * yourself. Both entry points (the deployment card and the history row menu)
 * share this so they can't drift apart again.
 *
 * The choice is "where is the output right now":
 *  - still building, or never got past it → the build log is the live stream
 *  - failed → the build log, which is where the reason almost always is; a
 *    deploy that died in its container still shows that log's tail there
 *  - otherwise → deploy logs, the running container's own output
 */
export type DeploymentLogTab = "build-logs" | "deploy-logs";

export function logTabForStatus(status: string | null | undefined): DeploymentLogTab {
  switch (status) {
    case "pending":
    case "building":
    case "failed":
    case "crashed":
    case "cancelled":
      return "build-logs";
    default:
      return "deploy-logs";
  }
}

/** The same choice as the panel's Logs-tab source. */
export function logSourceForStatus(status: string | null | undefined): "build" | "deploy" {
  return logTabForStatus(status) === "build-logs" ? "build" : "deploy";
}
