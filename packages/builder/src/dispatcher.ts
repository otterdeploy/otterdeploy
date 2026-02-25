import type { BuildMethod, Builder } from "./types";
import { NixpacksBuilder } from "./adapters/nixpacks";
import { DockerfileBuilder } from "./adapters/dockerfile";
import { DockerImageBuilder } from "./adapters/docker-image";
import { StaticBuilder } from "./adapters/static";

const builders: Record<string, () => Builder> = {
  nixpacks: () => new NixpacksBuilder(),
  dockerfile: () => new DockerfileBuilder(),
  docker_image: () => new DockerImageBuilder(),
  static: () => new StaticBuilder(),
};

export function getBuilder(method: BuildMethod): Builder {
  const factory = builders[method];
  if (!factory) throw new Error(`Unknown build method: ${method}`);
  return factory();
}
