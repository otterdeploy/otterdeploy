import { implement } from "@orpc/server";
import { contract } from "./contract";

export function createHealthRouter() {
  return implement(contract).router({
    health: implement(contract.health).handler(async () => {
      return {
        status: "ok" as const,
        timestamp: new Date().toISOString(),
      };
    }),
  });
}

export type AppRouter = ReturnType<typeof createHealthRouter>;
