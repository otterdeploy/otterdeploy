import { describe, it, expect } from "vitest";
import { getBuilder } from "../dispatcher";
import { NixpacksBuilder } from "../adapters/nixpacks";
import { DockerfileBuilder } from "../adapters/dockerfile";
import { DockerImageBuilder } from "../adapters/docker-image";
import { StaticBuilder } from "../adapters/static";

describe("getBuilder", () => {
  it("returns NixpacksBuilder for nixpacks method", () => {
    const builder = getBuilder("nixpacks");
    expect(builder).toBeInstanceOf(NixpacksBuilder);
  });

  it("returns DockerfileBuilder for dockerfile method", () => {
    const builder = getBuilder("dockerfile");
    expect(builder).toBeInstanceOf(DockerfileBuilder);
  });

  it("returns DockerImageBuilder for docker_image method", () => {
    const builder = getBuilder("docker_image");
    expect(builder).toBeInstanceOf(DockerImageBuilder);
  });

  it("returns StaticBuilder for static method", () => {
    const builder = getBuilder("static");
    expect(builder).toBeInstanceOf(StaticBuilder);
  });

  it("throws on unknown build method", () => {
    expect(() => getBuilder("compose")).toThrow("Unknown build method: compose");
  });

  it("throws on completely invalid method", () => {
    // @ts-expect-error testing invalid input
    expect(() => getBuilder("invalid_method")).toThrow("Unknown build method: invalid_method");
  });
});
