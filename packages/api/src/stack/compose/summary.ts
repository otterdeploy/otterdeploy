/**
 * Derive the UI/storage summary (`ComposeServiceSummary[]`) from a parsed
 * compose file. Persisted on the compose_resource and shown in the wizard
 * preview + graph. See docs/designs/compose.md.
 */
import type { ComposeServiceSummary } from "@otterdeploy/shared/compose";

import type { ParsedCompose } from "./types";

export function summarizeCompose(parsed: ParsedCompose): ComposeServiceSummary[] {
  return parsed.services.map((s) => ({
    name: s.name,
    image: s.image,
    hasBuild: s.build != null,
    ports: [...new Set(s.ports.map((p) => p.target))],
    // Named volumes only (binds/tmpfs are dropped at deploy). Deduped, source
    // name as written in the compose file — the chip the graph card renders.
    volumes: [
      ...new Set(
        s.volumes.filter((v) => v.type === "volume" && v.source).map((v) => v.source as string),
      ),
    ],
  }));
}
