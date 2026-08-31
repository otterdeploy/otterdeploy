import type { InferRouterOutputs } from "@orpc/server";
import type { AppRouter } from "@otterdeploy/api/routers/index";

/** Exactly one object row returned by the storage listing contract. */
export type StorageObjectRow = InferRouterOutputs<AppRouter>["storage"]["list"]["objects"][number];
