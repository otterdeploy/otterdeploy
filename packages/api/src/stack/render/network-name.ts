import { sanitizeProjectSlug } from "../../routers/project/views";

const PROJECT_NETWORK_PREFIX = "otterdeploy-resources-";

export function projectNetworkName(projectSlug: string): string {
  return `${PROJECT_NETWORK_PREFIX}${sanitizeProjectSlug(projectSlug)}`;
}
