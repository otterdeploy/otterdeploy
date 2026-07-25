import type { NodeEnrollmentId } from "@otterdeploy/shared/id";

import { ID_PREFIX } from "@otterdeploy/shared/id";
import { createHash } from "node:crypto";

export type EnrollmentRole = "worker" | "manager";

export function hashEnrollmentCredential(credential: string): string {
  return createHash("sha256").update(credential, "utf8").digest("hex");
}

export function parseEnrollmentCredential(credential: string): { id: NodeEnrollmentId } | null {
  const separator = credential.indexOf(".");
  if (separator < 1) return null;
  const id = credential.slice(0, separator);
  const secret = credential.slice(separator + 1);
  // createId uses a 24-character lowercase cuid2; randomBytes(32) produces
  // exactly 43 base64url characters. Exact bounds prevent oversized bearer
  // inputs from becoming DB/rate-limit-map keys.
  if (!/^enroll_[a-z0-9]{24}$/.test(id) || !id.startsWith(`${ID_PREFIX.nodeEnrollment}_`)) {
    return null;
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  return { id: id as NodeEnrollmentId };
}

export interface SwarmInspect {
  Version?: { Index?: number };
  Spec?: Record<string, unknown>;
}

export function buildSwarmRotationOptions(
  swarm: SwarmInspect,
  role: EnrollmentRole,
): Record<string, unknown> & {
  version: number;
  rotateWorkerToken: boolean;
  rotateManagerToken: boolean;
} {
  const version = swarm.Version?.Index;
  if (typeof version !== "number") throw new Error("Swarm version is unavailable.");
  return {
    version,
    ...swarm.Spec,
    rotateWorkerToken: role === "worker",
    rotateManagerToken: role === "manager",
  };
}
