import { systemService } from "@otterdeploy/domain";

import { publicProcedure } from "../index";

export const systemRouter = {
  health: publicProcedure.handler(async () => {
    return systemService.getHealth();
  }),
  ready: publicProcedure.handler(async () => {
    return systemService.getReadiness();
  }),
  version: publicProcedure.handler(async () => {
    return systemService.getVersion();
  }),
};
