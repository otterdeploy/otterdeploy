/**
 * What a failed Docker daemon call tells the caller.
 *
 * A 4xx is the daemon's verdict on the object the caller named (no such
 * container, volume in use, bad name): its words are the useful answer, so
 * they pass through. Anything else (the daemon's own 500, an unreachable or
 * hung socket) is about the host, and the daemon's text there carries host
 * paths and internals that used to reach the caller verbatim;
 * it is replaced by our own sentence.
 */
import {
  DockerBadRequestError,
  DockerConflictError,
  DockerNetworkError,
  DockerNotFoundError,
  DockerTimeoutError,
} from "@otterdeploy/docker";

const DOCKER_DAEMON_FAILED = "The Docker daemon could not complete the request.";
const DOCKER_DAEMON_UNREACHABLE = "Could not reach the Docker daemon.";

export function dockerFailureReason(error: unknown): string {
  if (
    error instanceof DockerNotFoundError ||
    error instanceof DockerConflictError ||
    error instanceof DockerBadRequestError
  ) {
    return error.message;
  }
  if (error instanceof DockerNetworkError || error instanceof DockerTimeoutError) {
    return DOCKER_DAEMON_UNREACHABLE;
  }
  return DOCKER_DAEMON_FAILED;
}
