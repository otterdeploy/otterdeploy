import { publicProcedure } from "../..";
import { listContainers, listImages, listNetworks, listTasks, listVolumes } from "./service";

export const dockerRouter = {
  containers: {
    list: publicProcedure.docker.containers.list.handler(async ({ input, errors }) => {
      const result = await listContainers(input);
      if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
      return result.items;
    }),
  },
  images: {
    list: publicProcedure.docker.images.list.handler(async ({ input, errors }) => {
      const result = await listImages(input);
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
  },
  networks: {
    list: publicProcedure.docker.networks.list.handler(async ({ errors }) => {
      const result = await listNetworks();
      if (!result.ok) throw errors.SERVER_ERROR({ message: result.reason });
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
};
