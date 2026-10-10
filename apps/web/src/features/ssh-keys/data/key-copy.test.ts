/**
 * The SSH keys page says what Rotate and Delete would touch before the click:
 * the servers a key signs in to, and which of them are down. It used to say
 * "Not in use" for a key a worker depended on, and Delete/Rotate said nothing
 * about the servers they would cut off (od-tbgu).
 */
import { describe, expect, it } from "vite-plus/test";

import { deleteTooltip, isUnreachable, rotateTooltip } from "./key-copy";
import { publicKeyParts } from "./ssh-keys";

const up = (name: string) => ({ name, state: { tone: "good" as const } });
const down = (name: string) => ({ name, state: { tone: "bad" as const } });

describe("rotateTooltip", () => {
  it("says how many servers a rotation re-authorizes", () => {
    expect(rotateTooltip([up("w1")])).toBe("Re-authorizes on 1 server");
    expect(rotateTooltip([up("a"), up("b"), up("c")])).toBe("Re-authorizes on 3 servers");
  });

  it("warns about a server that is down, by name", () => {
    expect(rotateTooltip([up("fra-1"), down("fra-3")])).toBe(
      "fra-3 is down; rotation stops unless every server takes the new key",
    );
  });

  it("is a plain replace for an unused key", () => {
    expect(rotateTooltip([])).toBe("Replace the keypair");
  });
});

describe("deleteTooltip", () => {
  it("names the servers that hold the delete", () => {
    expect(deleteTooltip([up("w1")])).toBe("In use by w1");
    expect(deleteTooltip([up("a"), up("b"), up("c")])).toBe("In use by a, b and c");
    expect(deleteTooltip([])).toBe("Delete key");
  });
});

describe("isUnreachable", () => {
  it("is true only for a server whose state is bad", () => {
    expect(isUnreachable(down("x"))).toBe(true);
    expect(isUnreachable(up("x"))).toBe(false);
    expect(isUnreachable({ name: "x", state: null })).toBe(false);
  });
});

describe("publicKeyParts", () => {
  it("middle-truncates the blob and keeps the comment whole", () => {
    const line =
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBev6oHhzebuzJaeGlLjkJ9iEeqwwjuV56qjfBZC6pwZ ci-deploy@runner-7";
    expect(publicKeyParts(line)).toEqual({
      type: "ssh-ed25519",
      blob: "AAAAC3NzaC1lZD…fBZC6pwZ",
      comment: "ci-deploy@runner-7",
    });
  });
});
