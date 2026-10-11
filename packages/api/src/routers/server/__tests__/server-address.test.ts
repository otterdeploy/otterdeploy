import { describe, expect, test } from "vite-plus/test";

import { serverAddress } from "../server-address";

describe("serverAddress", () => {
  test("the control plane is reachable at the install's public IP, not loopback", () => {
    // The bootstrap row's host is 127.0.0.1: that is how the control plane
    // reaches itself, not an address anyone else can use.
    expect(serverAddress({ host: "127.0.0.1" }, "203.0.113.7", { reveal: true })).toEqual({
      address: "203.0.113.7",
      addressHidden: false,
    });
  });

  test("with no public IP on record the control plane has no address to show", () => {
    expect(serverAddress({ host: "127.0.0.1" }, null, { reveal: true })).toEqual({
      address: null,
      addressHidden: false,
    });
  });

  test("any other server is reachable at the host it was registered with", () => {
    expect(serverAddress({ host: "10.0.0.5" }, "203.0.113.7", { reveal: true })).toEqual({
      address: "10.0.0.5",
      addressHidden: false,
    });
  });
});

describe("serverAddress: the install's public IP is for installation admins only", () => {
  test("anyone else gets the control plane without its address, marked as hidden", () => {
    expect(serverAddress({ host: "127.0.0.1" }, "203.0.113.7", { reveal: false })).toEqual({
      address: null,
      addressHidden: true,
    });
  });

  test("nothing is hidden when the install has no public IP on record", () => {
    expect(serverAddress({ host: "127.0.0.1" }, null, { reveal: false })).toEqual({
      address: null,
      addressHidden: false,
    });
  });

  test("a server the organization registered keeps its own host", () => {
    // Members add, retry and remove their organization's servers; the host
    // they registered is theirs to see.
    expect(serverAddress({ host: "10.0.0.5" }, "203.0.113.7", { reveal: false })).toEqual({
      address: "10.0.0.5",
      addressHidden: false,
    });
  });
});
