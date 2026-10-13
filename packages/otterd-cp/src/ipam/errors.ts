/**
 * Why the address plan refused an operation. `kind` is the node's stable
 * variant name and `message` its exact wording, so both planes report the
 * same refusal the same way.
 */
import { LARGEST_SCOPE_LEN, UNIT_LEN } from "./layout";

export type IpamErrorKind =
  | "NodeExists"
  | "UnknownNode"
  | "NoSlice"
  | "ScopeSize"
  | "ScopeExists"
  | "UnknownScope"
  | "SliceFull"
  | "ScopeFull"
  | "UnknownEndpoint"
  | "VipExhausted"
  | "VipExists"
  | "Conflict"
  | "UnknownQuarantine";

export interface IpamError {
  kind: IpamErrorKind;
  message: string;
}

const e = (kind: IpamErrorKind, message: string): IpamError => ({ kind, message });

export const ipamError = {
  nodeExists: (node: string, slice: string) =>
    e("NodeExists", `node ${node} already has slice ${slice}`),
  unknownNode: (node: string) => e("UnknownNode", `node ${node} is not enrolled`),
  noSlice: (live: number, quarantined: number) =>
    e(
      "NoSlice",
      `no free node slice: ${live} enrolled, ${quarantined} slices awaiting peer acknowledgement`,
    ),
  scopeSize: (len: number) =>
    e(
      "ScopeSize",
      `scope size /${len} is not supported (use /${LARGEST_SCOPE_LEN} to /${UNIT_LEN})`,
    ),
  scopeExists: (scope: string, net: string) =>
    e("ScopeExists", `scope ${scope} already has ${net} on this node`),
  unknownScope: (scope: string, node: string) =>
    e("UnknownScope", `scope ${scope} has no network on node ${node}`),
  sliceFull: (node: string, len: number) =>
    e(
      "SliceFull",
      `node ${node} has no free /${len} (exhausted networks need a planned recreation, not growth)`,
    ),
  scopeFull: (net: string) => e("ScopeFull", `${net} has no free endpoint address`),
  unknownEndpoint: (addr: string) => e("UnknownEndpoint", `${addr} is not an allocated endpoint`),
  vipExhausted: (range: string) =>
    e(
      "VipExhausted",
      `VIP range ${range} is exhausted; reclaiming addresses needs a disruptive maintenance plan`,
    ),
  vipExists: (vip: string, addr: string) => e("VipExists", `VIP ${vip} already has ${addr}`),
  conflict: (prefix: string, source: string, withNet: string) =>
    e(
      "Conflict",
      `${prefix} (${source}) overlaps ${withNet}; resolve the conflict before enrolling`,
    ),
  unknownQuarantine: (id: number) =>
    e("UnknownQuarantine", `quarantine entry ${id} does not exist`),
};
