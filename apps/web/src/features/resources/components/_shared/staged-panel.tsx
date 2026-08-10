/**
 * Shape of a resource that's pending creation. A staged-create ghost on the
 * graph that the operator hasn't applied yet.
 *
 * There's no backend resource behind one of these, so `details` carries the
 * manifest diff's create-change summary (the same payload the pending-changes
 * bar reads). Once applied, the node keeps its `${kind}:${name}` id and the
 * route resolves to the real resource panel automatically.
 */

import type { JsonObject } from "@otterdeploy/shared/json";

export interface StagedCreate {
  kind: "create";
  resource: "service" | "database";
  name: string;
  details?: JsonObject;
}
