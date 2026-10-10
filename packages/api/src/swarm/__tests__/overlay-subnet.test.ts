/**
 * After switching an install to
 * DEPLOY_RUNTIME=swarm the first deploy failed with "invalid pool request: Pool
 * overlaps with other one on this address space". The installer gives the
 * daemon's local pool 10.0.0.0/8 and `swarm init` keeps its own default of
 * 10.0.0.0/8, so the swarm handed the overlay a /24 a local bridge already
 * held. Overlays now get an explicit subnet outside both, free of every
 * network the daemon knows.
 */
import { describe, expect, test } from "vite-plus/test";

import { cidrRange, OVERLAY_SUBNET_BASE, pickOverlaySubnet } from "../overlay-subnet";

function overlaps(a: string, b: string): boolean {
  const x = cidrRange(a);
  const y = cidrRange(b);
  if (!x || !y) throw new Error(`not a cidr: ${a} / ${b}`);
  return x.start <= y.end && y.start <= x.end;
}

describe("pickOverlaySubnet", () => {
  test("the overlay range stays clear of Docker's default pools", () => {
    // The installer's daemon pool and the swarm's default pool (both 10/8),
    // and the stock local pools a host without that daemon.json uses
    // (172.17-172.31 as /16s, 192.168/16).
    const stock = Array.from({ length: 15 }, (_, i) => `172.${17 + i}.0.0/16`);
    for (const pool of ["10.0.0.0/8", ...stock, "192.168.0.0/16"]) {
      expect(overlaps(OVERLAY_SUBNET_BASE, pool), pool).toBe(false);
    }
  });

  test("never hands out a subnet a bridge or overlay already holds", () => {
    const used = ["10.0.1.0/24", "172.16.0.0/24", "172.16.1.0/25", "fd00::/64", "garbage"];
    const picked = pickOverlaySubnet(used);
    expect(picked).toBe("172.16.2.0/24");
    for (const u of used.filter((x) => cidrRange(x))) {
      expect(overlaps(picked ?? "", u), u).toBe(false);
    }
  });

  test("a wide network covering the start of the range is skipped past", () => {
    expect(pickOverlaySubnet(["172.16.0.0/20"])).toBe("172.16.16.0/24");
  });

  test("a full range answers null, so the swarm allocates as before", () => {
    expect(pickOverlaySubnet(["172.20.0.0/23"], "172.20.0.0/23")).toBeNull();
    expect(pickOverlaySubnet([], "not-a-cidr")).toBeNull();
  });
});
