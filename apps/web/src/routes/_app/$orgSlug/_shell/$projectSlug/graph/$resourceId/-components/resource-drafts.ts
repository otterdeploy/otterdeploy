/**
 * Synthetic "draft" resource views for staged-create ghosts on the graph.
 * Each builder turns a manifest entry into just enough of the real panel's
 * resource shape to render in pending mode. Split out of resource-panel.tsx
 * to keep that file under the line cap.
 */
import type { ProjectId } from "@otterdeploy/shared/id";

import { idSchema } from "@otterdeploy/shared/id";

import type { PostgresBodyProps } from "@/features/resources/components";

import { orpc } from "@/shared/server/orpc";

export type ManifestData = Awaited<ReturnType<typeof orpc.project.manifest.get.call>>;

// Pending drafts have no resource row yet, so no real ResourceId exists: a
// deterministic fake branded via the boundary validator stands in. Pending
// mode never calls resource-scoped APIs, so it is never sent anywhere.
const DRAFT_RESOURCE_ID = idSchema.resource.parse("res_draft");

// Synthetic "draft" service from the manifest entry: enough to render the
// panel; the resourceId is the draft sentinel because no resource row exists
// yet (pending mode never calls resource-scoped APIs). Returns null unless
// `resourceId` is a staged `service:<name>` ghost whose spec is present in
// the manifest.
export function draftServiceFromManifest(
  manifestData: ManifestData | undefined,
  resourceId: string,
  pendingName: string,
  projectId: ProjectId,
) {
  if (!resourceId.startsWith("service:")) return null;
  const spec = manifestData?.manifest?.services?.[pendingName];
  if (!spec) return null;
  return {
    resourceId: DRAFT_RESOURCE_ID,
    projectId,
    name: pendingName,
    image: spec.source === "image" ? spec.image : "Pending build",
    source: spec.source,
    replicas: spec.replicas ?? 1,
    status: "draft",
    publicEnabled: false,
    publicDomain: null,
    extraEnv: spec.env ?? {},
    secretKeys: [],
    buildConfig: spec.source === "git" ? spec.build : undefined,
  };
}

// Staged database create → the REAL database panel in pending mode. Only the
// fields the pending tab bodies read carry real values; runtime/credential
// fields are unused while pending, so they hold inert empty placeholders. A
// complete typed view (no cast) keeps the draft from drifting out of sync
// with the server contract.
export function draftDatabaseFromManifest(
  manifestData: ManifestData | undefined,
  resourceId: string,
  pendingName: string,
  projectId: ProjectId,
): PostgresBodyProps["resource"] | null {
  if (!resourceId.startsWith("database:")) return null;
  const spec = manifestData?.manifest?.databases?.[pendingName];
  if (!spec) return null;
  return {
    resourceId: DRAFT_RESOURCE_ID,
    projectId,
    environmentId: null,
    name: pendingName,
    type: "database",
    status: "draft",
    latestDeploymentStatus: null,
    latestDeploymentStartedAt: null,
    latestDeploymentFinishedAt: null,
    engine: spec.engine,
    placementServerId: null,
    // A staged database can declare a server by name; the id only exists once
    // it is applied, so the draft carries null and the panel reads the name
    // from the manifest spec instead.
    hostResourceId: null,
    hostName: "host" in spec ? (spec.host ?? null) : null,
    connectionLimit: "connectionLimit" in spec ? (spec.connectionLimit ?? null) : null,
    // Inert credential/endpoint placeholders: unused while pending.
    databaseName: "",
    username: "",
    password: "",
    publicEnabled: spec.publicEnabled ?? false,
    publicHostname: "",
    publicPort: 1,
    publicConnectionString: "",
    internalHostname: "",
    internalPort: 1,
    internalConnectionString: "",
    localConnectionString: null,
    upstreamHost: "",
    upstreamPort: 1,
    runtime: {
      serviceId: null,
      serviceName: "",
      volumeName: "",
      networkName: "",
      status: "missing",
      health: null,
    },
    extraEnv: spec.extraEnv ?? {},
    secretKeys: [],
    extensions: spec.engine === "postgres" ? (spec.extensions ?? []) : [],
  };
}

// Staged compose (stack) create → the real compose panel in pending mode.
// The manifest's compose entry carries the file source/content, not a
// per-service breakdown (that's parsed from the file at deploy time), so the
// draft renders with an empty service list, same "honest, not fabricated"
// posture as the other drafts. Mirrors draftServiceFromManifest /
// draftDatabaseFromManifest so a compose ghost node (id `compose:<name>`,
// no resourceId yet) opens a panel instead of falling through to NotFound.
export function draftComposeFromManifest(
  manifestData: ManifestData | undefined,
  resourceId: string,
  pendingName: string,
  projectId: ProjectId,
) {
  if (!resourceId.startsWith("compose:")) return null;
  const spec = manifestData?.manifest?.composes?.[pendingName];
  if (!spec) return null;
  return {
    resourceId: "",
    projectId,
    name: pendingName,
    status: "draft",
    latestDeploymentStatus: "pending" as const,
    source: spec.source,
    stackName: pendingName,
    // Left empty on purpose: the panel parses `composeContent` and fills this
    // in. Parsing is a server round-trip (`compose.parse`) and this builder is
    // sync, so the panel owns it. Hardcoding `[]` and stopping there is what
    // made every staged stack claim "No services parsed" no matter what its
    // compose file declared.
    services: [],
    logoBrand: spec.logoBrand ?? null,
    /** Staged compose YAML, for the draft panel's Services/Compose tabs.
     *  Inline stacks carry it in the manifest; a git stack has none until it
     *  is cloned, so the draft shows the file only after deploy. */
    composeContent: spec.source === "inline" ? spec.content : null,
    /** Staged stack variables, the values the operator can still edit before
     *  the first deploy (a template's domain lands here). */
    stageEnv: spec.env ?? {},
  };
}
