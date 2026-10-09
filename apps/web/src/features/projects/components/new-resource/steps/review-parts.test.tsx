/**
 * The apply note names the runtime this install deploys with.
 * The installer default is plain Docker, where a service is one container and
 * nothing goes through Swarm, so "via Docker Swarm" there is a false promise.
 */
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vite-plus/test";

import { ApplyNote } from "./review-parts";

function note(runtime: "swarm" | "docker" | null, replicas = 1, kindId = "docker") {
  return renderToStaticMarkup(
    <ApplyNote kind={{ id: kindId }} model={{ isDb: false, replicas }} runtime={runtime} />,
  );
}

describe("ApplyNote", () => {
  it("on the plain-Docker runtime it says a container is run, never Swarm", () => {
    const text = note("docker");
    expect(text).not.toContain("Swarm");
    expect(text).toContain("pull the image and run it as a Docker container");
  });

  it("on the plain-Docker runtime it does not promise replicas it will not run", () => {
    const text = note("docker", 3, "node");
    expect(text).not.toContain("3 replicas");
    expect(text).toContain("one container per service");
  });

  it("on the Swarm runtime it names Swarm and the replica count", () => {
    expect(note("swarm", 3)).toContain("deploy 3 replicas via Docker Swarm");
  });

  it("before the runtime is known it names neither", () => {
    const text = note(null);
    expect(text).not.toContain("Swarm");
    expect(text).toContain("pull the image and start it");
  });
});
