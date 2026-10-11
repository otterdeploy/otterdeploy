import { describe, expect, it } from "vite-plus/test";

import { DOCKER_PORT_DEFAULTS, defaultImagePort } from "../image-defaults";
import { portsListSchema } from "../schemas/networking";

describe("docker flow: the container port is filled in, not just hinted", () => {
  it("starts on a port the networking step accepts", () => {
    // The row used to start empty under an "80" placeholder, so a public row
    // looked filled in and then failed "Enter the container port to publish".
    expect(portsListSchema.safeParse(DOCKER_PORT_DEFAULTS).success).toBe(true);
    expect(DOCKER_PORT_DEFAULTS[0]?.port).toBe(80);
  });

  it("uses an image's conventional port when known, else 80", () => {
    expect(defaultImagePort("redis:8-alpine")).toBe(6379);
    expect(defaultImagePort("docker.io/library/nginx:1.27")).toBe(80);
    expect(defaultImagePort("ghcr.io/corentinth/it-tools:latest")).toBe(80);
  });
});
