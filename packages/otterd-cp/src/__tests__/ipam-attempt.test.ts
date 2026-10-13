/**
 * What a grant takes from the address plan, and how the address comes back.
 */
import { describe, expect, test } from "bun:test";

import {
  DEFAULT_LAYOUT,
  acknowledgeAddress,
  formatAddr,
  formatNet,
  newPlan,
  placeAttempt,
  releaseEndpoint,
  resolverAddress,
} from "../ipam/index";

describe("placeAttempt", () => {
  test("takes the node's slice and the scope's /27 on first use, then the next address", () => {
    const p = newPlan(DEFAULT_LAYOUT).unwrap();
    const a = placeAttempt(p, "shop-prod", "w1").unwrap();
    expect([formatNet(a.subnet), formatAddr(a.address)]).toEqual(["172.24.0.0/27", "172.24.0.2"]);
    const b = placeAttempt(p, "shop-prod", "w1").unwrap();
    expect(formatAddr(b.address)).toBe("172.24.0.3");
    expect(formatNet(placeAttempt(p, "shop-dev", "w1").unwrap().subnet)).toBe("172.24.0.32/27");
    expect(formatNet(placeAttempt(p, "shop-prod", "w2").unwrap().subnet)).toBe("172.24.32.0/27");
  });

  test("a released address waits for its peers, then comes back", () => {
    const p = newPlan(DEFAULT_LAYOUT).unwrap();
    const a = placeAttempt(p, "s", "w1").unwrap();
    expect(acknowledgeAddress(p, a.address, "w2")).toBeNull();
    releaseEndpoint(p, a.address, new Set(["w2", "w3"])).unwrap();
    expect(formatAddr(placeAttempt(p, "s", "w1").unwrap().address)).toBe("172.24.0.3");
    expect(acknowledgeAddress(p, a.address, "w2")?.unwrap()).toBe(false);
    expect(acknowledgeAddress(p, a.address, "w3")?.unwrap()).toBe(true);
    expect(placeAttempt(p, "s", "w1").unwrap().address).toBe(a.address);
  });

  test("resolver listeners come from the DNS range, never its network or broadcast address", () => {
    const p = newPlan(DEFAULT_LAYOUT).unwrap();
    expect(formatAddr(resolverAddress(p, 1) ?? 0)).toBe("172.30.228.1");
    expect(resolverAddress(p, 0)).toBeNull();
    expect(resolverAddress(p, 1023)).toBeNull();
  });
});
