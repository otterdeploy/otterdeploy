/**
 * Shared daemon client + result shape for the docker debug service layer
 * (service.ts lists, service-admin.ts inspect/logs/destructive ops).
 */
import { DockerNotFoundError } from "@otterdeploy/docker";

import { createRequestDockerClient } from "../../lib/docker-client";
import { dockerFailureReason } from "../../lib/docker-failure";

export const docker = createRequestDockerClient();

export type Listed<T> =
  | { ok: true; items: T }
  | { ok: false; reason: string; kind?: "not_found" | "conflict" };

export function failure(error: unknown): { ok: false; reason: string; kind?: "not_found" } {
  if (error instanceof DockerNotFoundError) {
    return { ok: false, reason: error.message, kind: "not_found" };
  }
  return { ok: false, reason: dockerFailureReason(error) };
}
