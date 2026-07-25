/**
 * Docker-image flow defaults derived from the typed image reference.
 *
 * Two honest derivations, nothing speculative:
 *   - `imageBasename` → the service-name seed ("nginx", not "docker"): the
 *     last path segment of the reference, tag/digest stripped, slug-safe.
 *   - `knownImagePort` → the conventional listen port for a short list of
 *     official images whose EXPOSE is common knowledge. Anything not in the
 *     table stays empty — a wrong guess (the old hardcoded 3000) breaks
 *     publishing silently, an empty field asks the operator.
 */

import type { Port } from "./form-fields/ports-field";

/** Pristine ports row for the docker flow: no invented port. Public stays
 *  the default-on it is elsewhere; the schema requires a real port before a
 *  public row can continue. */
export const DOCKER_PORT_DEFAULTS: Port[] = [{ port: 0, protocol: "http", public: true, host: "" }];

/** "ghcr.io/owner/app:1.2@sha256:…" → "app". Empty string when nothing
 *  name-like can be extracted. */
export function imageBasename(image: string): string {
  const noDigest = image.trim().split("@")[0];
  const last = noDigest.split("/").pop() ?? "";
  // Only the last segment can carry a tag (registry hosts carry ports, but
  // those live in the first segment which we've already dropped).
  const noTag = last.split(":")[0];
  return noTag
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

// Conventional container ports for well-known official images (their
// published EXPOSE). Keyed by basename so "docker.io/library/nginx:1.27"
// and "nginx" both hit.
const KNOWN_IMAGE_PORTS: Record<string, number> = {
  nginx: 80,
  httpd: 80,
  caddy: 80,
  traefik: 80,
  wordpress: 80,
  whoami: 80,
  redis: 6379,
  valkey: 6379,
  postgres: 5432,
  mysql: 3306,
  mariadb: 3306,
  mongo: 27017,
  rabbitmq: 5672,
  minio: 9000,
  registry: 5000,
  grafana: 3000,
  ghost: 2368,
  meilisearch: 7700,
};

export function knownImagePort(image: string): number | null {
  return KNOWN_IMAGE_PORTS[imageBasename(image)] ?? null;
}
