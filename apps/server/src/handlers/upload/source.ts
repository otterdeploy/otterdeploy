import type { OrganizationId, ResourceId } from "@otterdeploy/shared/id";
import type { Context } from "hono";

import { resolveRequestActor } from "@otterdeploy/api/authz/actor";
import { authorizeCapability } from "@otterdeploy/api/authz/capability";
import { prepareSourceTarballPath, removeSourceTarball } from "@otterdeploy/api/lib/data-dir";
import { markDeploymentFailed } from "@otterdeploy/api/routers/project/deployments";
import {
  createUploadDeployment,
  resolveUploadSourceTarget,
  setUploadDeploymentSourceSha,
  triggerUploadBuild,
} from "@otterdeploy/api/routers/project/upload-source";
import { MAX_SOURCE_UPLOAD_BYTES } from "@otterdeploy/api/security/body-limit";
import { Result } from "better-result";

/**
 * `POST /api/services/:resourceId/source` — receive an uploaded source tarball
 * for a `source: "upload"` service, stage it on the shared data dir, and enqueue
 * the build. This is a raw Hono route (not oRPC) because the body is a binary
 * stream, mirroring the raw webhook routes. Auth: the CLI's bearer session token
 * or an `otter_`-prefixed org API key.
 *
 * Ordering matters: create the deployment row first (its id keys the tarball
 * path), stream bytes to disk with a hard size cap, then trigger. Any failure
 * after the row exists marks it failed so it never strands as `pending`.
 */

/** Hard cap on an uploaded tarball. gzip'd source; generous for real projects,
 *  a wall against a runaway/hostile upload filling the disk. Shared with the
 *  request-level body-limit gate (packages/api/src/security/body-limit.ts)
 *  so the two caps can never drift apart. */
const MAX_UPLOAD_BYTES = MAX_SOURCE_UPLOAD_BYTES;

/** Stream the request body into `path`, enforcing the byte cap and hashing the
 *  bytes as they pass through. Returns the sha256 (hex) content digest of the
 *  tarball. Throws on overflow or a missing body; the caller cleans up. */
async function streamBodyToFile(c: Context, path: string): Promise<string> {
  const reader = c.req.raw.body?.getReader();
  if (!reader) throw new Error("empty request body");
  const writer = Bun.file(path).writer();
  const hasher = new Bun.CryptoHasher("sha256");
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_UPLOAD_BYTES) {
        throw new Error(`source tarball exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`);
      }
      hasher.update(value);
      // FileSink.write returns a number, or a Promise on backpressure — await
      // handles both and satisfies no-floating-promises.
      await writer.write(value);
    }
    await writer.flush();
  } finally {
    await writer.end();
  }
  if (total === 0) throw new Error("empty request body");
  return hasher.digest("hex");
}

export async function uploadSourceHandler(c: Context): Promise<Response> {
  const actor = await resolveRequestActor(c.req.raw.headers);
  if (!actor) {
    return c.json({ error: "Authentication required." }, 401);
  }

  const organizationId =
    actor.kind === "api-key" ? actor.organizationId : actor.session.activeOrganizationId;
  if (!organizationId) {
    return c.json({ error: "An active organization is required." }, 403);
  }

  const resourceId = c.req.param("resourceId") as ResourceId;
  const target = await resolveUploadSourceTarget({
    resourceId,
    organizationId: organizationId as OrganizationId,
  });
  if (!target) {
    return c.json({ error: "service not found" }, 404);
  }

  const decision = await authorizeCapability(actor, {
    scope: "organization",
    mode: "write",
    organizationId: target.organizationId,
    projectId: target.projectId,
    permission: { service: ["deploy"] },
  });
  if (!decision.allowed) {
    return c.json({ error: decision.reason }, decision.status);
  }

  const created = await createUploadDeployment({
    resourceId,
    organizationId: target.organizationId,
  });
  if (created.isErr()) {
    return c.json({ error: created.error }, 404);
  }
  const { projectId, deploymentId } = created.value;

  const path = await prepareSourceTarballPath(projectId, deploymentId);
  if (!path) {
    const message = "the control plane has no writable data folder for uploaded source";
    await markDeploymentFailed(deploymentId, message).catch(() => undefined);
    return c.json({ error: message }, 503);
  }

  const staged = await Result.tryPromise({
    try: () => streamBodyToFile(c, path),
    catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
  });
  if (staged.isErr()) {
    await removeSourceTarball(path);
    await markDeploymentFailed(deploymentId, `source upload failed: ${staged.error}`).catch(
      () => undefined,
    );
    return c.json({ error: staged.error }, 400);
  }

  // Record the tarball's content hash so the deploy carries a stable source
  // identifier (the upload analog of a commit sha). Best-effort — a write
  // failure here must not strand or fail an otherwise-good upload.
  const sourceSha = staged.value;
  await setUploadDeploymentSourceSha(deploymentId, sourceSha).catch(() => undefined);

  const triggered = await triggerUploadBuild({
    target: { projectId, deploymentId },
    resourceId,
  });
  if (triggered.isErr()) {
    await removeSourceTarball(path);
    return c.json({ error: triggered.error }, 502);
  }

  return c.json({ deploymentId, sourceSha });
}
