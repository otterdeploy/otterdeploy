/**
 * Streams docker image pull progress as an async generator.
 *
 * docker.pull() returns a newline-delimited JSON stream. Each line is one
 * event from the engine — examples:
 *   {"status":"Pulling from library/postgres","id":"18-alpine"}
 *   {"status":"Pulling fs layer","progressDetail":{},"id":"a1b2c3"}
 *   {"status":"Downloading","progressDetail":{"current":1234,"total":56789},"progress":"[>   ]  1.2MB/56.7MB","id":"a1b2c3"}
 *   {"status":"Pull complete","progressDetail":{},"id":"a1b2c3"}
 *   {"status":"Status: Downloaded newer image for postgres:18-alpine"}
 *
 * We pass each event through unfiltered so the UI can show layer-level
 * activity. If the image is already present locally, docker still emits
 * `Already exists` events for each layer — the operator sees an instant
 * cached pull and the create proceeds.
 *
 * Errors during pull surface as `{ error: "...", errorDetail: {...} }`
 * events; we yield them as a `pull` event with `status: "error"` and the
 * caller decides whether to abort.
 */

import type { Docker } from "@otterdeploy/docker";

import { DockerNotFoundError } from "@otterdeploy/docker";
import { Readable } from "node:stream";

import { readNdjson } from "./stream-parse";

export interface ImagePullEvent {
  image: string;
  id: string | null;
  status: string;
  progress: string | null;
  current: number | null;
  total: number | null;
}

/**
 * Per-pull credentials for private registries. The SDK forwards these via
 * the `X-Registry-Auth` header (base64-encoded JSON). `serveraddress` MUST
 * match the registry host in the image ref or the daemon rejects the auth
 * (ghcr.io credentials won't work on docker.io).
 *
 * `null` means "anonymous pull" — public images go through this path.
 */
export interface RegistryAuth {
  username: string;
  password: string;
  serveraddress: string;
}

interface DockerPullLine {
  status?: string;
  id?: string;
  progress?: string;
  progressDetail?: { current?: number; total?: number };
  error?: string;
  errorDetail?: { message?: string };
}

function toEvent(image: string, line: DockerPullLine): ImagePullEvent {
  return {
    image,
    id: line.id ?? null,
    status: line.error ?? line.errorDetail?.message ?? line.status ?? "unknown",
    progress: line.progress ?? null,
    current: line.progressDetail?.current ?? null,
    total: line.progressDetail?.total ?? null,
  };
}

// Yield pull-progress events for `image`. If the image already exists
// locally, emits a single synthetic `Already present` event and returns —
// no network round-trip wasted. Pass `auth` to authenticate against a
// private registry (ghcr.io PAT, AWS ECR token, etc.); omit it for public
// images.
export async function* streamImagePull(
  docker: Docker,
  image: string,
  auth?: RegistryAuth | null,
): AsyncGenerator<ImagePullEvent, void, void> {
  const inspectResult = await docker.images.getImage(image).inspect();
  if (inspectResult.isOk()) {
    yield {
      image,
      id: null,
      status: "Already present",
      progress: null,
      current: null,
      total: null,
    };
    return;
  }
  if (!(inspectResult.error instanceof DockerNotFoundError)) {
    throw inspectResult.error;
  }

  const pullResult = await docker.pull(image, auth ? { authconfig: auth } : undefined);
  if (pullResult.isErr()) throw pullResult.error;

  // The docker SDK returns a Node stream; ensure we have something with
  // an async iterator regardless of the underlying transport.
  const stream =
    pullResult.value instanceof Readable
      ? pullResult.value
      : Readable.from(pullResult.value as NodeJS.ReadableStream);

  for await (const line of readNdjson<DockerPullLine>(stream)) {
    yield toEvent(image, line);
    if (line.error || line.errorDetail) {
      // Surface the error event and stop iterating — caller decides whether
      // to throw.
      return;
    }
  }
}
