import { describe, expect, test } from "vite-plus/test";

import { serverAddress } from "../server-address";

describe("serverAddress", () => {
  test("the control plane is reachable at the install's public IP, not loopback", () => {
    // The bootstrap row's host is 127.0.0.1: that is how the control plane
    // reaches itself, not an address anyone else can use.
    expect(serverAddress({ host: "127.0.0.1" }, "203.0.113.7")).toBe("203.0.113.7");
  });

  test("with no public IP on record the control plane has no address to show", () => {
    expect(serverAddress({ host: "127.0.0.1" }, null)).toBeNull();
  });

  test("any other server is reachable at the host it was registered with", () => {
    expect(serverAddress({ host: "10.0.0.5" }, "203.0.113.7")).toBe("10.0.0.5");
  });
});
