/**
 * `POST /api/services/:resourceId/source` answers its own failures
 * without echoing a lower layer's text. A caller's unusable upload (no body,
 * an empty body, over the cap) is told so; a staging failure (a disk error
 * naming a server path) or a queue failure (a Redis error naming its host) is
 * logged and answered generically.
 *
 * Drives the REAL handler; the actor, authorization, deployment rows, data
 * folder and queue are replaced so each failure can be produced on its own.
 */

import * as actor from "@otterdeploy/api/authz/actor";
import * as capability from "@otterdeploy/api/authz/capability";
import * as dataDir from "@otterdeploy/api/lib/data-dir";
import * as deployments from "@otterdeploy/api/routers/project/deployments";
import * as uploadSource from "@otterdeploy/api/routers/project/upload-source";
import { MAX_SOURCE_UPLOAD_BYTES } from "@otterdeploy/api/security/body-limit";
import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as z from "zod";

import { uploadSourceHandler } from "../source";

const ORG_ID = idSchema.organization.parse("org_uploaderrors00000000000000");
const RESOURCE_ID = "res_uploaderrors00000000000000";

const stage: { path: string } = { path: "" };

// Spies, not module mocks: bun's module mocks outlive this file and would
// replace the real actor resolver for every test file that runs after it.
// mock.restore() below puts every spied export back.
const triggerUploadBuild = spyOn(uploadSource, "triggerUploadBuild");
beforeEach(() => {
  stage.path = join(tmpdir(), `otterdeploy-upload-${crypto.randomUUID()}.tgz`);
  spyOn(actor, "resolveRequestActor").mockImplementation(async () =>
    Result.ok({
      kind: "api-key",
      id: "key_1",
      permissions: null,
      organizationId: ORG_ID,
    }),
  );
  spyOn(capability, "authorizeCapability").mockImplementation(async () => ({ allowed: true }));
  spyOn(dataDir, "prepareSourceTarballPath").mockImplementation(async () => stage.path);
  spyOn(dataDir, "removeSourceTarball").mockImplementation(async () => {});
  spyOn(deployments, "markDeploymentFailed").mockImplementation(async () => {});
  spyOn(uploadSource, "resolveUploadSourceTarget").mockImplementation(async () => ({
    organizationId: ORG_ID,
    projectId: idSchema.project.parse("prj_uploaderrors00000000000000"),
    source: "upload",
  }));
  spyOn(uploadSource, "createUploadDeployment").mockImplementation(async () =>
    Result.ok({
      projectId: idSchema.project.parse("prj_uploaderrors00000000000000"),
      deploymentId: idSchema.deployment.parse("dep_uploaderrors00000000000000"),
    }),
  );
  spyOn(uploadSource, "setUploadDeploymentSourceSha").mockImplementation(async () => {});
  triggerUploadBuild.mockImplementation(async () =>
    Result.ok({ deploymentId: "dep_uploaderrors00000000000000" }),
  );
});
afterEach(async () => {
  await rm(stage.path, { force: true });
});
afterAll(() => {
  mock.restore();
});

const app = new Hono().post("/api/services/:resourceId/source", uploadSourceHandler);
const errorBody = z.object({ error: z.string() });

async function upload(body: Uint8Array | ReadableStream<Uint8Array> | null) {
  const response = await app.request(`/api/services/${RESOURCE_ID}/source`, {
    method: "POST",
    headers: { "x-api-key": "otter_testkey", "content-type": "application/gzip" },
    body,
  });
  return { status: response.status, body: errorBody.parse(await response.json()) };
}

describe("upload source failures answer without a lower layer's text", () => {
  test("no body at all is the caller's mistake, said plainly", async () => {
    expect(await upload(null)).toEqual({ status: 400, body: { error: "empty request body" } });
  });

  test("an empty body is the caller's mistake, said plainly", async () => {
    expect(await upload(new Uint8Array([]))).toEqual({
      status: 400,
      body: { error: "empty request body" },
    });
  });

  test("an upload over the cap is the caller's mistake, said plainly", async () => {
    // One reused 1 MiB chunk, streamed until just past the cap.
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const oversized = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > MAX_SOURCE_UPLOAD_BYTES) {
          controller.close();
          return;
        }
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const response = await upload(oversized);
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("source tarball exceeds the");
  });

  test("a staging failure does not echo the disk error (and its server path)", async () => {
    stage.path = "/nonexistent/otterdeploy-upload-errors/dir/source.tgz";
    expect(await upload(new Uint8Array([1, 2, 3]))).toEqual({
      status: 500,
      body: { error: "source upload failed" },
    });
  });

  test("a queue failure does not echo the Redis error", async () => {
    triggerUploadBuild.mockImplementation(async () =>
      Result.err(
        "could not queue the build (is Redis/the builder running?): connect ECONNREFUSED 10.0.0.7:6379",
      ),
    );
    expect(await upload(new Uint8Array([1, 2, 3]))).toEqual({
      status: 502,
      body: { error: "could not queue the build; try again" },
    });
  });
});
