/**
 * Container + volume names for the SERVER a hosted database lives on.
 *
 * A tenant has neither of its own, so every place that would render or inspect
 * them has to render the host's instead — and the host may live in a different
 * project, which is why these take the host row rather than the caller's own
 * project slug.
 */
import type { HostRow } from "../../../database-hosting";

import { buildContainerName, buildVolumeName } from "../view-helpers";

export function hostContainerName(host: HostRow): string {
  return buildContainerName({
    engine: host.engine,
    projectSlug: host.projectSlug,
    resourceName: host.name,
  });
}

export function hostVolumeName(host: HostRow): string {
  return buildVolumeName({
    engine: host.engine,
    projectSlug: host.projectSlug,
    resourceName: host.name,
  });
}
