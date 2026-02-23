export { getBuilder } from "./dispatcher";
export { NixpacksBuilder } from "./adapters/nixpacks";
export { DockerfileBuilder } from "./adapters/dockerfile";
export { DockerImageBuilder } from "./adapters/docker-image";
export { StaticBuilder } from "./adapters/static";
export { prepareBuildContext } from "./context";
export {
  getImageName,
  getImageTag,
  tagAsLatest,
  pruneOldTags,
} from "./tagging";
export type {
  BuildInput,
  BuildOutput,
  BuildMethod,
  Builder,
} from "./types";
