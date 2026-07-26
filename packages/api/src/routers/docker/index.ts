import type { Context } from "../../context";

import { requireInstallAdmin } from "../..";
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

function auditSensitiveRead(context: Context, action: string, target: string): void {
  context.log.set({ target: { type: "docker", id: target } });
  const user = context.session?.user;
  if (!user) return;
  context.log.audit?.({
    action,
    actor: { type: "user", id: user.id, email: user.email },
    outcome: "success",
  });
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

export const dockerRouter = {
  containers: {
    list: requireInstallAdmin().docker.containers.list.handler(async ({ input, errors }) => {
      const result = await listContainers(input);
      if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
      return result.items;
    }),
    inspect: requireInstallAdmin().docker.containers.inspect.handler(
      async ({ input, errors, context }) => {
        const result = await inspectContainer(input.id);
        if (!result.ok) throwDockerError(result, errors);
        auditSensitiveRead(context, "docker.containers.inspect", input.id);
        return result.items;
      },
    ),
    logs: requireInstallAdmin().docker.containers.logs.handler(
      async ({ input, errors, context }) => {
        const result = await tailContainerLogs(input.id, input.tail ?? 200);
        if (!result.ok) throwDockerError(result, errors);
        auditSensitiveRead(context, "docker.containers.logs", input.id);
        return { lines: result.items };
      },
    ),
  },
  images: {
    list: requireInstallAdmin().docker.images.list.handler(async ({ input, errors }) => {
      const result = await listImages(input);
      if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
      return result.items;
    }),
    inspect: requireInstallAdmin().docker.images.inspect.handler(
      async ({ input, errors, context }) => {
        const result = await inspectImage(input.id);
        if (!result.ok) throwDockerError(result, errors);
        auditSensitiveRead(context, "docker.images.inspect", input.id);
        return result.items;
      },
    ),
    remove: requireInstallAdmin().docker.images.remove.handler(
      async ({ input, errors, context }) => {
        context.log.set({ target: { type: "docker-image", id: input.id } });
        const result = await removeImage(input.id, input.force ?? false);
        if (!result.ok) throwDockerError(result, errors);
        return result.items;
      },
    ),
    prune: requireInstallAdmin().docker.images.prune.handler(async ({ errors }) => {
      const result = await pruneImages();
      if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
      return result.items;
    }),
  },
  volumes: {
    list: requireInstallAdmin().docker.volumes.list.handler(async ({ errors }) => {
      const result = await listVolumes();
      if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
      return result.items;
    }),
    inspect: requireInstallAdmin().docker.volumes.inspect.handler(
      async ({ input, errors, context }) => {
        const result = await inspectVolume(input.name);
        if (!result.ok) throwDockerError(result, errors);
        auditSensitiveRead(context, "docker.volumes.inspect", input.name);
        return result.items;
      },
    ),
    remove: requireInstallAdmin().docker.volumes.remove.handler(
      async ({ input, errors, context }) => {
        context.log.set({ target: { type: "docker-volume", id: input.name } });
        const result = await removeVolume(input.name);
        if (!result.ok) throwDockerError(result, errors);
        return result.items;
      },
    ),
  },
  networks: {
    list: requireInstallAdmin().docker.networks.list.handler(async ({ errors }) => {
      const result = await listNetworks();
      if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
      return result.items;
    }),
    inspect: requireInstallAdmin().docker.networks.inspect.handler(
      async ({ input, errors, context }) => {
        const result = await inspectNetwork(input.id);
        if (!result.ok) throwDockerError(result, errors);
        auditSensitiveRead(context, "docker.networks.inspect", input.id);
        return result.items;
      },
    ),
    remove: requireInstallAdmin().docker.networks.remove.handler(
      async ({ input, errors, context }) => {
        context.log.set({ target: { type: "docker-network", id: input.id } });
        const result = await removeNetwork(input.id);
        if (!result.ok) throwDockerError(result, errors);
        return result.items;
      },
    ),
  },
  tasks: {
    list: requireInstallAdmin().docker.tasks.list.handler(async ({ errors }) => {
      const result = await listTasks();
      if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
      return result.items;
    }),
  },
  nodes: {
    list: requireInstallAdmin().docker.nodes.list.handler(async ({ errors }) => {
      const result = await listNodes();
      if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
      return result.items;
    }),
  },
};
