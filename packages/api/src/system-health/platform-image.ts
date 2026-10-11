/**
 * Which image the install actually runs, and which of its own containers
 * disagree with it.
 *
 * The server, the build worker and the per-node health agent are one unified
 * image with different commands. The server and builder get theirs from the
 * compose file; the health agent is created by the server at runtime, and used
 * to be pinned to `${OTTERDEPLOY_REGISTRY}/server:${OTTERDEPLOY_VERSION}`: the
 * published release. An install whose compose file points somewhere else (a
 * locally built tag, a mirror, an image override) then ran the agent on a
 * different build than everything else, and nothing said so.
 *
 * The source of truth is the server's own container: whatever image it was
 * started from is the install's image. The configured registry/version is the
 * fallback for a server that is not running in a container (local dev).
 */
import { Docker } from "@otterdeploy/docker";
import { env } from "@otterdeploy/env/server";
import { hostname } from "node:os";

/** What a container was started from: the reference it names, and the image
 *  id it resolved to (null when unknown). */
export interface ImageIdentity {
  image: string;
  imageId: string | null;
}

/** The roles that run the unified server image. */
export type PlatformRole = "server" | "builder" | "health-agent";

export interface PlatformComponent {
  name: string;
  role: PlatformRole;
  image: string;
  state: string;
  /** Same build as the server (same image id when both are known, else the
   *  same reference). */
  matchesServer: boolean;
}

export interface PlatformImages {
  /** The version the server reports (its OTTERDEPLOY_VERSION). */
  version: string;
  server: ImageIdentity & {
    /** `container`: read from the server's own container. `configured`: the
     *  server is not in a container, so this is the configured release. */
    source: "container" | "configured";
  };
  /** False when the server's image tag is not the version it reports, e.g. a
   *  locally built image on an install pinned to a release. */
  imageMatchesVersion: boolean;
  components: PlatformComponent[];
}

/** The configured release image (registry + version from the install's env). */
export function configuredServerImage(): string {
  return `${env.OTTERDEPLOY_REGISTRY}/server:${env.OTTERDEPLOY_VERSION}`;
}

/** The image the health agent must run: the server's own, else the
 *  configured release. */
export function agentImageFor(own: ImageIdentity | null, configured: string): string {
  return own?.image || configured;
}

/** `registry:5000/owner/server:v1@sha256:…` → `v1`; null when untagged. */
export function imageTag(ref: string): string | null {
  const noDigest = ref.split("@")[0] ?? "";
  const last = noDigest.split("/").pop() ?? "";
  const colon = last.indexOf(":");
  return colon === -1 ? null : last.slice(colon + 1);
}

function sameImage(a: ImageIdentity, b: ImageIdentity): boolean {
  if (a.imageId && b.imageId) return a.imageId === b.imageId;
  const strip = (ref: string) => ref.split("@")[0];
  return strip(a.image) === strip(b.image);
}

/** The role a container plays in the install, from the labels compose,
 *  swarm and the agent reconciler stamp. Null for anything that does not run
 *  the server image. `project` is the server's own compose project or stack
 *  namespace, so another install on the same daemon is never counted. */
export function platformRoleOf(
  labels: Record<string, string>,
  project: string | null,
): PlatformRole | null {
  if (labels["otterdeploy.role"] === "health-agent") return "health-agent";
  if (!project) return null;
  let service: string | undefined;
  if (labels["com.docker.compose.project"] === project) {
    service = labels["com.docker.compose.service"];
  } else if (labels["com.docker.stack.namespace"] === project) {
    service = labels["com.docker.swarm.service.name"]?.slice(project.length + 1);
  }
  return service === "server" || service === "builder" ? service : null;
}

/** The compose project (or swarm stack) the server's container belongs to. */
export function projectOf(labels: Record<string, string>): string | null {
  return labels["com.docker.compose.project"] ?? labels["com.docker.stack.namespace"] ?? null;
}

/** Each container that runs the server image, compared with the server's. */
export function comparePlatformImages(
  server: ImageIdentity,
  project: string | null,
  containers: ReadonlyArray<{
    name: string;
    labels: Record<string, string>;
    image: string;
    imageId: string | null;
    state: string;
  }>,
): PlatformComponent[] {
  const components: PlatformComponent[] = [];
  for (const c of containers) {
    const role = platformRoleOf(c.labels, project);
    if (!role) continue;
    components.push({
      name: c.name,
      role,
      image: c.image,
      state: c.state,
      matchesServer: sameImage(server, c),
    });
  }
  const order: Record<PlatformRole, number> = { server: 0, builder: 1, "health-agent": 2 };
  return components.sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name));
}

interface OwnContainer extends ImageIdentity {
  labels: Record<string, string>;
}

/** The server's own container, by the hostname Docker gives it (its id).
 *  Null when the server is not in a container, or the daemon can't say. */
async function inspectOwnContainer(docker: Docker): Promise<OwnContainer | null> {
  const inspected = await docker.containers.inspect(hostname());
  if (inspected.isErr()) return null;
  const image = inspected.value.Config.Image;
  if (!image) return null;
  return {
    image,
    imageId: inspected.value.Image || null,
    labels: inspected.value.Config.Labels ?? {},
  };
}

/** The image the server runs: its own container's, else the configured release. */
export async function resolveServerImage(docker: Docker): Promise<ImageIdentity | null> {
  const own = await inspectOwnContainer(docker);
  return own ? { image: own.image, imageId: own.imageId } : null;
}

/** The server's image and every container of the install that runs the
 *  server image on this daemon, flagged where it is a different build. */
export async function listPlatformImages(): Promise<PlatformImages> {
  const docker = Docker.fromEnv();
  try {
    const own = await inspectOwnContainer(docker);
    const version = env.OTTERDEPLOY_VERSION;
    const server: PlatformImages["server"] = own
      ? { image: own.image, imageId: own.imageId, source: "container" }
      : { image: configuredServerImage(), imageId: null, source: "configured" };
    const project = own ? projectOf(own.labels) : null;

    const listed = await docker.containers.list({ all: true });
    const containers = listed.isOk()
      ? listed.value.map((c) => ({
          name: (c.Names[0] ?? c.Id.slice(0, 12)).replace(/^\//, ""),
          labels: c.Labels ?? {},
          image: c.Image,
          imageId: c.ImageID || null,
          state: c.State,
        }))
      : [];

    return {
      version,
      server,
      imageMatchesVersion: imageTag(server.image) === version,
      components: comparePlatformImages(server, project, containers),
    };
  } finally {
    docker.destroy();
  }
}
