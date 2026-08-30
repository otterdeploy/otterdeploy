/**
 * Stack delete has to name the SAME docker volumes the deploy created, or it
 * reclaims nothing (or, worse, something else). The names come from the
 * stored service summaries through the one mapper the deploy uses.
 */
import { describe, expect, it } from "vite-plus/test";

import { stackVolumeNames } from "../volumes";

describe("stackVolumeNames", () => {
  it("maps every mounted named volume through composeVolumeName, deduped", () => {
    const names = stackVolumeNames(
      [
        { volumes: ["postiz-config", "postiz-uploads"] },
        { volumes: ["postiz-db"] },
        { volumes: ["postiz-redis"] },
        // A second service mounting the same volume must not list it twice.
        { volumes: ["postiz-uploads"] },
      ],
      "shared-postiz",
    );
    expect(names).toEqual([
      "od-shared-postiz-postiz-config",
      "od-shared-postiz-postiz-uploads",
      "od-shared-postiz-postiz-db",
      "od-shared-postiz-postiz-redis",
    ]);
  });

  it("is empty for a stack with no named volumes", () => {
    expect(stackVolumeNames([{ volumes: [] }, { volumes: [] }], "x")).toEqual([]);
  });
});
