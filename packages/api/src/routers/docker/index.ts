import { orgScopedProcedure, publicProcedure, requirePermission } from "../..";
import {
  inspectContainer,
  inspectImage,
  inspectNetwork,
  inspectVolume,
  listContainers,
  listImages,
  listNetworks,
  listNodes,
  listTasks,
  listVolumes,
  pruneImages,
  removeImage,
  removeNetwork,
  removeVolume,
  tailContainerLogs,
} from "./service";

interface Failed {
  ok: false;
  reason: string;
  kind?: "not_found" | "conflict";
}
interface MutationErrors {
  SERVER_ERROR: (opts: { message: string }) => Error;
  NOT_FOUND?: (opts: { message: string }) => Error;
  CONFLICT?: (opts: { message: string }) => Error;
}

/** Map a service-layer failure onto the matching contract error. */
function throwDockerError(result: Failed, errors: MutationErrors): never {
  if (result.kind === "not_found" && errors.NOT_FOUND) {
    throw errors.NOT_FOUND({ message: result.reason });
  }
  if (result.kind === "conflict" && errors.CONFLICT) {
    throw errors.CONFLICT({ message: result.reason });
  }
  throw errors.SERVER_ERROR({ message: result.reason });
}

// Reads (inspect / logs / nodes) require an authenticated org actor, matching
// terminal.targets. Destructive daemon surgery is install-wide platform
// administration — gated like system.* on `platform:update` (admins/owners).
const platformWrite = requirePermission({ platform: ["update"] });

export const dockerRouter = {
  containers: {
    list: publicProcedure.docker.containers.list.handler(async ({ input, errors }) => {
      const result = await listContainers(input);
      if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
      return result.items;
    }),
    inspect: orgScopedProcedure.docker.containers.inspect.handler(async ({ input, errors }) => {
      const result = await inspectContainer(input.id);
      if (!result.ok) throwDockerError(result, errors);
      return result.items;
    }),
    logs: orgScopedProcedure.docker.containers.logs.handler(async ({ input, errors }) => {
      const result = await tailContainerLogs(input.id, input.tail ?? 200);
      if (!result.ok) throwDockerError(result, errors);
      return { lines: result.items };
    }),
  },
  images: {
    list: publicProcedure.docker.images.list.handler(async ({ input, errors }) => {
      const result = await listImages(input);
      if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
      return result.items;
    }),
    inspect: orgScopedProcedure.docker.images.inspect.handler(async ({ input, errors }) => {
      const result = await inspectImage(input.id);
      if (!result.ok) throwDockerError(result, errors);
      return result.items;
    }),
    remove: platformWrite.docker.images.remove.handler(async ({ input, errors, context }) => {
      context.log.set({ target: { type: "docker-image", id: input.id } });
      const result = await removeImage(input.id, input.force ?? false);
      if (!result.ok) throwDockerError(result, errors);
      return result.items;
    }),
    prune: platformWrite.docker.images.prune.handler(async ({ errors }) => {
      const result = await pruneImages();
      if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
      return result.items;
    }),
  },
  volumes: {
    list: publicProcedure.docker.volumes.list.handler(async ({ errors }) => {
      const result = await listVolumes();
      if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
      return result.items;
    }),
    inspect: orgScopedProcedure.docker.volumes.inspect.handler(async ({ input, errors }) => {
      const result = await inspectVolume(input.name);
      if (!result.ok) throwDockerError(result, errors);
      return result.items;
    }),
    remove: platformWrite.docker.volumes.remove.handler(async ({ input, errors, context }) => {
      context.log.set({ target: { type: "docker-volume", id: input.name } });
      const result = await removeVolume(input.name);
      if (!result.ok) throwDockerError(result, errors);
      return result.items;
    }),
  },
  networks: {
    list: publicProcedure.docker.networks.list.handler(async ({ errors }) => {
      const result = await listNetworks();
      if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
      return result.items;
    }),
    inspect: orgScopedProcedure.docker.networks.inspect.handler(async ({ input, errors }) => {
      const result = await inspectNetwork(input.id);
      if (!result.ok) throwDockerError(result, errors);
      return result.items;
    }),
    remove: platformWrite.docker.networks.remove.handler(async ({ input, errors, context }) => {
      context.log.set({ target: { type: "docker-network", id: input.id } });
      const result = await removeNetwork(input.id);
      if (!result.ok) throwDockerError(result, errors);
      return result.items;
    }),
  },
  tasks: {
    list: publicProcedure.docker.tasks.list.handler(async ({ errors }) => {
      const result = await listTasks();
      if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
      return result.items;
    }),
  },
  nodes: {
    list: orgScopedProcedure.docker.nodes.list.handler(async ({ errors }) => {
      const result = await listNodes();
      if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
      return result.items;
    }),
  },
};
