import { oc } from "@orpc/contract";
import * as z from "zod";

import { SystemHealthSchema, SystemReadySchema, SystemVersionSchema } from "../schemas";
import { route } from "../http";

export const systemContract = {
  health: oc.route(route("GET", "/system/health")).input(z.object({})).output(SystemHealthSchema),
  ready: oc.route(route("GET", "/system/ready")).input(z.object({})).output(SystemReadySchema),
  version: oc
    .route(route("GET", "/system/version"))
    .input(z.object({}))
    .output(SystemVersionSchema),
};
