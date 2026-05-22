import { publicProcedure } from "../..";

import { listContainers } from "./service";

export const dockerRouter = {
  containers: {
    list: publicProcedure.docker.containers.list.handler(async ({ input, errors }) => {
      const result = await listContainers(input);
      if (!result.ok) {
        throw errors.SERVER_ERROR({ message: result.reason });
      }
      return result.containers;
    }),
  },
};
