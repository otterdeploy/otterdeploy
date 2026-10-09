/**
 * After the build: give every `VOLUME` the image declares a persistent home.
 *
 * Reads the paths from the BUILT image (`docker image inspect`), not from the
 * Dockerfile text, because that is what docker will act on: a VOLUME in an
 * intermediate stage does not reach the final image, and one inherited from a
 * base image (`FROM postgres`) never appears in this Dockerfile at all.
 *
 * Each path is then backed by the service's attached mount at that path, or a
 * new named volume (packages/api/src/routers/service/image-volumes.ts), and
 * the build log says which, so an operator can see where their data lives.
 * A preview is the exception: it shares the base service's mount rows, so
 * writing one here would hand production a volume a preview asked for. A
 * preview's VOLUME paths stay anonymous and go away with the preview.
 */
import type { ResourceId } from "@otterdeploy/shared/id";

import {
  backImageVolumes,
  type ImageVolumeBacking,
} from "@otterdeploy/api/routers/service/image-volumes";
import { Result } from "better-result";
import * as z from "zod";

import type { LogSink } from "./log-stream";

import { BuildStepError } from "./errors";
import { runProcess } from "./run-process";

/** `.Config.Volumes` as docker prints it: `{"/data":{}}`, or `null` for none. */
const imageVolumesSchema = z.record(z.string(), z.unknown()).nullable();

/** A sink that keeps a command's output out of the deployment log: the
 *  inspect prints JSON the operator has no use for. */
function quietSink(sink: LogSink): LogSink {
  return { ...sink, write: () => undefined };
}

/** The paths `image` declares as VOLUME, sorted. Empty when it declares none. */
export async function readImageVolumes(
  image: string,
  sink: LogSink,
): Promise<Result<string[], BuildStepError>> {
  const fail = (cause: unknown) => new BuildStepError({ step: "image-volumes", cause });
  const inspected = await Result.tryPromise({
    try: () =>
      runProcess({
        cmd: "docker",
        args: ["image", "inspect", "--format", "{{json .Config.Volumes}}", image],
        sink: quietSink(sink),
        echo: false,
      }),
    catch: fail,
  });
  if (inspected.isErr()) return Result.err(inspected.error);
  if (inspected.value.exitCode !== 0) {
    return Result.err(
      fail(`docker image inspect exited ${inspected.value.exitCode}: ${inspected.value.tail}`),
    );
  }
  const output = inspected.value.tail.trim();
  return Result.try({
    try: () => {
      const volumes = imageVolumesSchema.parse(JSON.parse(output));
      return Object.keys(volumes ?? {}).sort((a, b) => a.localeCompare(b));
    },
    catch: fail,
  });
}

/** One build-log line per declared path: where its data now lives. */
export function describeImageVolume(backing: ImageVolumeBacking): string {
  if (backing.kind === "created") {
    return `VOLUME ${backing.path}: backed by new persistent volume ${backing.volumeName}; its data survives redeploys`;
  }
  const what = backing.source ? `${backing.mountType} ${backing.source}` : backing.mountType;
  return `VOLUME ${backing.path}: already backed by the attached ${what}`;
}

/** Read the image's VOLUME paths and back each one (base builds), or explain
 *  that a preview's stay ephemeral. */
export async function persistImageVolumes(args: {
  image: string;
  serviceResourceId: ResourceId;
  serviceName: string;
  isPreview: boolean;
  sink: LogSink;
}): Promise<Result<ImageVolumeBacking[], BuildStepError>> {
  const declared = await readImageVolumes(args.image, args.sink);
  if (declared.isErr()) return Result.err(declared.error);
  if (declared.value.length === 0) return Result.ok([]);
  if (args.isPreview) {
    args.sink.system(
      `VOLUME ${declared.value.join(", ")}: not persisted for a preview; the preview starts empty there and the data goes away with it`,
    );
    return Result.ok([]);
  }
  const backed = await Result.tryPromise({
    try: () =>
      backImageVolumes({
        serviceResourceId: args.serviceResourceId,
        serviceName: args.serviceName,
        declared: declared.value,
      }),
    catch: (cause) => new BuildStepError({ step: "image-volumes", cause }),
  });
  if (backed.isErr()) return Result.err(backed.error);
  for (const backing of backed.value) args.sink.system(describeImageVolume(backing));
  return Result.ok(backed.value);
}
