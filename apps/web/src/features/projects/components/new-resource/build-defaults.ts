/**
 * What the new-service wizard defaults from a repo inspection
 * (`git.inspectRepo` for the bound repo + root directory): which builder runs,
 * which service type that implies, and which port the container listens on.
 *
 * One rule, in this order:
 *
 *   1. A Dockerfile at the root directory is the build. The repo's author
 *      already said how to build and serve it (it-tools: a Vite build copied
 *      into nginx on port 80); railpack guessing again from package.json
 *      produces a different image on a different port. Railpack is the
 *      fallback when there is no Dockerfile, so nothing changes for those
 *      repos.
 *   2. The service type follows that decision. A static site always builds
 *      with railpack (to-manifest `staticSiteBuildConfig`), so preselecting
 *      it for a repo with a Dockerfile would silently throw the Dockerfile
 *      away. Without one, the framework decides, as before.
 *   3. The port comes from the build that will actually run: the Dockerfile's
 *      EXPOSE when the Dockerfile builds it, else the framework's conventional
 *      port. Each default says where it came from.
 *
 * Pure: the Source step applies these through `AUTO_WRITE`, and the Networking
 * and Review steps read them to explain what they show.
 */

import { frameworkDefaultPort } from "@otterdeploy/shared/framework";

import { frameworkDefaultServiceType, frameworkLabel } from "./frameworks";

export interface DockerfileDetection {
  /** Repo-relative path, e.g. `Dockerfile` or `apps/web/Dockerfile`. */
  path: string;
  /** TCP ports the final stage EXPOSEs, first is the one to publish. */
  exposedPorts: number[];
}

export interface RepoDetection {
  framework: string | null;
  dockerfile: DockerfileDetection | null;
}

/** The two builders the wizard offers for a git web app or worker. */
export type ServiceBuilder = "dockerfile" | "railpack";

/** Builder for a freshly bound repo: its Dockerfile when it has one. */
export function defaultBuilder(detection: RepoDetection): ServiceBuilder {
  return detection.dockerfile ? "dockerfile" : "railpack";
}

/**
 * The builder that will really run for a wizard `builderId`. Ids other than
 * the two explicit ones (the advanced Builder step's buildpack / static cards)
 * emit `builder: "auto"`, which the build worker resolves the same way
 * `defaultBuilder` does; `compose` builds as railpack.
 */
export function resolvedBuilder(builderId: string, detection: RepoDetection): ServiceBuilder {
  if (builderId === "dockerfile") return "dockerfile";
  if (builderId === "railpack" || builderId === "compose") return "railpack";
  return defaultBuilder(detection);
}

/** "Web app" vs "Static site", following the builder decision. */
export function defaultServiceType(detection: RepoDetection): "app" | "static" {
  if (detection.dockerfile) return "app";
  return frameworkDefaultServiceType(detection.framework);
}

export interface PortDefault {
  port: number;
  /** Where it came from, so the Networking step can say so. */
  source: "dockerfile" | "framework";
}

/** The container port to prefill for this builder, or null when nothing knows. */
export function defaultPort(builderId: string, detection: RepoDetection): PortDefault | null {
  if (resolvedBuilder(builderId, detection) === "dockerfile") {
    const exposed = detection.dockerfile?.exposedPorts[0];
    if (exposed !== undefined) return { port: exposed, source: "dockerfile" };
  }
  const port = frameworkDefaultPort(detection.framework);
  return port === null ? null : { port, source: "framework" };
}

/** The Networking step's subtitle: what the port default is and why. */
export function portDefaultHint(builderId: string, detection: RepoDetection): string | null {
  const fallback = defaultPort(builderId, detection);
  const usesDockerfile = resolvedBuilder(builderId, detection) === "dockerfile";
  if (fallback?.source === "dockerfile") {
    return `Port ${fallback.port} prefilled from EXPOSE in /${detection.dockerfile?.path ?? "Dockerfile"}.`;
  }
  if (usesDockerfile && detection.dockerfile) {
    const noExpose = `/${detection.dockerfile.path} declares no EXPOSE.`;
    return fallback
      ? `${noExpose} Port ${fallback.port} is the ${frameworkLabel(detection.framework)} default; set the port your image listens on.`
      : `${noExpose} Set the port your image listens on.`;
  }
  if (fallback) {
    return `Detected ${frameworkLabel(detection.framework)}. Port ${fallback.port} prefilled; most apps don't need to change it.`;
  }
  return null;
}

/** The Review step's "Build" row. */
export function buildSummary(kindId: string, builderId: string, detection: RepoDetection): string {
  if (kindId === "static") return "Railpack · static site served by Caddy";
  if (resolvedBuilder(builderId, detection) === "dockerfile") {
    return `Dockerfile · /${detection.dockerfile?.path ?? "Dockerfile"}`;
  }
  return "Railpack · auto-detected";
}
