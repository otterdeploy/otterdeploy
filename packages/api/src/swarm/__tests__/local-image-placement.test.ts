/**
 * Once a worker joined the swarm, the
 * first deploy of an upload-built service never got a running task: the
 * scheduler put it on the worker, which cannot pull the registry-less image the
 * builder loaded into the manager's daemon ("pull access denied for
 * otterdeploy-local/shop-web"). An unpinned registry-less image is now
 * pinned to the node that holds it.
 */
import { describe, expect, test } from "vite-plus/test";

import { placementForImage } from "../local-image-placement";

const MANAGER = "k3x9w2m5q8r1t4y7";

describe("placementForImage", () => {
  test("pins an unpinned registry-less image to the node that built it", () => {
    expect(
      placementForImage({
        image: "otterdeploy-local/shop-web:dep_abc",
        placementNodeId: null,
        localNodeId: MANAGER,
      }),
    ).toBe(MANAGER);
  });

  test("leaves the operator's pin alone", () => {
    expect(
      placementForImage({
        image: "otterdeploy-local/web:dep_abc",
        placementNodeId: "w1nodeid0001",
        localNodeId: MANAGER,
      }),
    ).toBe("w1nodeid0001");
  });

  test("a pullable image is free to run anywhere", () => {
    expect(
      placementForImage({ image: "nginx:alpine", placementNodeId: null, localNodeId: MANAGER }),
    ).toBeNull();
  });

  test("no swarm node id (not in a swarm) pins nothing", () => {
    expect(
      placementForImage({
        image: "otterdeploy-local/web:1",
        placementNodeId: null,
        localNodeId: "",
      }),
    ).toBeNull();
  });
});
