/**
 * Tell an INFRASTRUCTURE build failure apart from a broken Dockerfile.
 *
 * When the builder cannot resolve or reach a registry, every layer above
 * reports `build step "build" failed: dockerfile build failed (exit 1)`. That
 * sentence points at the user's Dockerfile, so the user debugs their
 * Dockerfile. On the Praxly deploy that cost three consecutive builds and a
 * long detour through GHCR before anyone suspected the platform (od-71bq).
 *
 * The tell is unambiguous and worth acting on: the failure happens at
 * `[internal] load metadata`, before a single instruction runs, and names a
 * DNS or dial error against a registry host. A Dockerfile cannot cause that.
 * Nothing the user writes changes whether buildkitd can resolve
 * `registry-1.docker.io`.
 *
 * This deliberately only CLASSIFIES and explains. It does not try to repair
 * the host: the underlying cause is environment-specific (systemd-resolved on
 * loopback, a restrictive DOCKER-USER guard, an egress firewall) and guessing
 * wrong would be worse than saying clearly what happened and where to look.
 */

/**
 * Registry resolution/connectivity failures, as buildkit reports them.
 *
 * Matched against the log TAIL, so the patterns have to be specific enough not
 * to fire on an application's own build output. A Dockerfile whose RUN step
 * prints "i/o timeout" should not be reported as a platform fault, hence
 * anchoring on buildkit's own vocabulary rather than on the bare error text.
 */
const REGISTRY_HOST =
  /registry-1\.docker\.io|ghcr\.io|quay\.io|gcr\.io|[a-z0-9.-]+\.amazonaws\.com/i;

const RESOLUTION_FAILURE =
  /failed to (?:do request|resolve source metadata|copy: httpReadSeeker)|dial tcp: lookup|no such host|i\/o timeout|temporary failure in name resolution/i;

/** The phase that proves it happened before any instruction ran. */
const METADATA_PHASE = /load metadata for|failed to solve/i;

export interface InfraFailure {
  /** One line naming what actually failed, for the deployment record. */
  summary: string;
  /** What the operator should check, in the order worth checking it. */
  remedy: string;
}

/**
 * Classify a failed build's log tail, or null when it looks like an ordinary
 * build failure.
 *
 * Conservative on purpose: it demands a registry host AND a resolution-shaped
 * error AND the metadata phase. A false positive here tells someone their
 * Dockerfile is fine when it is not, which is the same disease in the other
 * direction.
 */
export function classifyInfraFailure(tail: string): InfraFailure | null {
  if (!REGISTRY_HOST.test(tail)) return null;
  if (!RESOLUTION_FAILURE.test(tail)) return null;
  if (!METADATA_PHASE.test(tail)) return null;

  return {
    summary:
      "The build server could not reach the container registry, so the base image could not be " +
      "pulled. This is an infrastructure problem, not a fault in your Dockerfile: the build " +
      "failed before any instruction ran.",
    remedy:
      "The BuildKit builder container has no working DNS or no egress, even when the host " +
      "itself does (the host's own `docker pull` uses a different network path than a " +
      "container's). On the build host, check: `docker run --rm alpine nslookup " +
      "registry-1.docker.io` to confirm container DNS; `/etc/docker/daemon.json` for a `dns` " +
      "entry when the host resolves via 127.0.0.53 (systemd-resolved); and the DOCKER-USER " +
      "chain, which the otterdeploy firewall baseline uses to drop new outbound TCP to ports " +
      "other than 80/443. After changing daemon config, `docker buildx rm otterdeploy-cache` " +
      "so the builder is recreated.",
  };
}
