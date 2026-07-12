import type { OrganizationId, ResourceId } from "@otterdeploy/shared/id";
import type { Context } from "hono";

import { prepareSourceTarballPath, removeSourceTarball } from "@otterdeploy/api/lib/data-dir";
import { markDeploymentFailed } from "@otterdeploy/api/routers/project/deployments";
import {
  createUploadDeployment,
  triggerUploadBuild,
} from "@otterdeploy/api/routers/project/upload-source";
import { auth } from "@otterdeploy/auth";
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
 *  a wall against a runaway/hostile upload filling the disk. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const API_KEY_PREFIX = "otter_";

async function resolveOrganizationId(c: Context): Promise<OrganizationId | null> {
  // Bearer session token (what the CLI sends) or browser cookies.
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session?.session.activeOrganizationId) {
    return session.session.activeOrganizationId as OrganizationId;
  }
  // `otter_`-prefixed org API key (OTTERDEPLOY_TOKEN in CI).
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (token?.startsWith(API_KEY_PREFIX)) {
    const verified = await Result.tryPromise({
      try: () => auth.api.verifyApiKey({ body: { key: token } }),
      catch: (cause) => cause,
    });
    if (verified.isOk() && verified.value.valid && verified.value.key) {
      return (verified.value.key.referenceId ?? null) as OrganizationId | null;
    }
  }
  return null;
}

/** Stream the request body into `path`, enforcing the byte cap. Throws on
 *  overflow or a missing body; the caller cleans up. */
async function streamBodyToFile(c: Context, path: string): Promise<void> {
  const reader = c.req.raw.body?.getReader();
  if (!reader) throw new Error("empty request body");
  const writer = Bun.file(path).writer();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_UPLOAD_BYTES) {
        throw new Error(`source tarball exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`);
      }
      // FileSink.write returns a number, or a Promise on backpressure — await
      // handles both and satisfies no-floating-promises.
      await writer.write(value);
    }
    await writer.flush();
  } finally {
    await writer.end();
  }
  if (total === 0) throw new Error("empty request body");
}

export async function uploadSourceHandler(c: Context): Promise<Response> {
  const organizationId = await resolveOrganizationId(c);
  if (!organizationId) {
    return c.json({ error: "Authentication required (or no active organization)." }, 401);
  }

  const resourceId = c.req.param("resourceId") as ResourceId;
  const created = await createUploadDeployment({ resourceId, organizationId });
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

  const triggered = await triggerUploadBuild({
    target: { projectId, deploymentId },
    resourceId,
  });
  if (triggered.isErr()) {
    await removeSourceTarball(path);
    return c.json({ error: triggered.error }, 502);
  }

  return c.json({ deploymentId });
}
