import { requirePermission } from "../..";
import { listContainers, listImages, listNetworks, listTasks, listVolumes } from "./service";

// Raw host-daemon inventory (every container/image/volume/network on the node,
// across all orgs) is an instance-wide operator view, so it's gated on the
// platform:read permission — the same gate as system.* host inspection — rather
// than plain org membership. (Previously publicProcedure: unauthenticated.)
const dockerRead = requirePermission({ platform: ["read"] });

export const dockerRouter = {
  containers: {
    list: dockerRead.docker.containers.list.handler(async ({ input, errors }) => {
      const result = await listContainers(input);
      if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
      return result.items;
    }),
  },
  images: {
    list: dockerRead.docker.images.list.handler(async ({ input, errors }) => {
      const result = await listImages(input);
      if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
      return result.items;
    }),
  },
  volumes: {
    list: dockerRead.docker.volumes.list.handler(async ({ errors }) => {
      const result = await listVolumes();
      if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
      return result.items;
    }),
  },
  networks: {
    list: dockerRead.docker.networks.list.handler(async ({ errors }) => {
      const result = await listNetworks();
      if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
      return result.items;
    }),
  },
  tasks: {
    list: dockerRead.docker.tasks.list.handler(async ({ errors }) => {
      const result = await listTasks();
      if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
      return result.items;
    }),
  },
};
