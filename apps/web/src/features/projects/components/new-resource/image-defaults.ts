/**
 * Docker-image flow defaults derived from the typed image reference.
 *
 * Two honest derivations, nothing speculative:
 *   - `imageBasename` → the service-name seed ("nginx", not "docker"): the
 *     last path segment of the reference, tag/digest stripped, slug-safe.
 *   - `defaultImagePort` → the conventional listen port for a short list of
 *     official images whose EXPOSE is common knowledge, else 80 (HTTP's own
 *     port). The value is written INTO the field, where the operator sees
 *     and can change it, and the review shows it. An empty field with an
 *     "80" placeholder looked filled in and then failed validation.
 */

import type { Port } from "./form-fields/ports-field";

/** A web image's port when the table below doesn't know the image. */
const HTTP_PORT = 80;

/** Pristine ports row for the docker flow: HTTP on 80, public, the default-on
 *  it is elsewhere. Step Image replaces the port once it knows the image. */
export const DOCKER_PORT_DEFAULTS: Port[] = [
  { port: HTTP_PORT, protocol: "http", public: true, host: "" },
];

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

/** The port the docker flow fills in for `image`: its conventional one when
 *  known, else 80. */
export function defaultImagePort(image: string): number {
  return KNOWN_IMAGE_PORTS[imageBasename(image)] ?? HTTP_PORT;
}
