/**
 * The fleet address plan: one supernet carved into node slices, scope
 * networks, stable service addresses and system ranges, with a no-reuse
 * quarantine. A port of the node's plan that must reproduce its parity
 * vectors exactly, results and state alike.
 */
import { Result } from "better-result";

import { type Layout, validateLayout } from "./layout";
import { type AddressPlan, emptyPlan } from "./state";

export * from "./addr";
export * from "./errors";
export * from "./layout";
export * from "./nodes";
export * from "./quarantine";
export * from "./scopes";
export * from "./state";

/** An empty plan over a validated layout. */
export const newPlan = (layout: Layout): Result<AddressPlan, string> =>
  validateLayout(layout).map(emptyPlan);
