/**
 * Iconography for a container service, keyed off its image ref.
 *
 * Two layers, deliberately separate:
 *  - IDENTITY (`ServiceImageIcon`): what the container *runs*: Postgres,
 *    Redis, Vaultwarden, … or a neutral shipping-container mark when the image
 *    isn't one we know.
 *  - RUNTIME (`ServiceImageTile`): the identity glyph on a tile with a small
 *    Docker badge in the corner. Every compose member is a Docker container, so
 *    the whale is a footnote, not a name: as the *main* mark it made every
 *    non-database service in a stack look identical.
 */

import type { ComponentType, SVGProps } from "react";

import { ContainerIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Authentik } from "@/shared/components/ui/svgs/authentik";
import { Baserow } from "@/shared/components/ui/svgs/baserow";
import { BunLogo } from "@/shared/components/ui/svgs/bun";
import { Dbeaver } from "@/shared/components/ui/svgs/dbeaver";
import { Directus } from "@/shared/components/ui/svgs/directus";
import { Docker } from "@/shared/components/ui/svgs/docker";
import { Dozzle } from "@/shared/components/ui/svgs/dozzle";
import { Drizzle } from "@/shared/components/ui/svgs/drizzle";
import { EclipseMosquitto } from "@/shared/components/ui/svgs/eclipse-mosquitto";
import { Excalidraw } from "@/shared/components/ui/svgs/excalidraw";
import { Forgejo } from "@/shared/components/ui/svgs/forgejo";
import { Ghost } from "@/shared/components/ui/svgs/ghost";
import { Gitea } from "@/shared/components/ui/svgs/gitea";
import { Gitlab } from "@/shared/components/ui/svgs/gitlab";
import { Go } from "@/shared/components/ui/svgs/go";
import { Grafana } from "@/shared/components/ui/svgs/grafana";
import { Harbor } from "@/shared/components/ui/svgs/harbor";
import { Hasura } from "@/shared/components/ui/svgs/hasura";
import { Hoppscotch } from "@/shared/components/ui/svgs/hoppscotch";
import { ItTools } from "@/shared/components/ui/svgs/it-tools";
import { Jaeger } from "@/shared/components/ui/svgs/jaeger";
import { Keycloak } from "@/shared/components/ui/svgs/keycloak";
import { Libretranslate } from "@/shared/components/ui/svgs/libretranslate";
import { Listmonk } from "@/shared/components/ui/svgs/listmonk";
import { Mariadb } from "@/shared/components/ui/svgs/mariadb";
import { Matomo } from "@/shared/components/ui/svgs/matomo";
import { Meilisearch } from "@/shared/components/ui/svgs/meilisearch";
import { Metabase } from "@/shared/components/ui/svgs/metabase";
import { Minio } from "@/shared/components/ui/svgs/minio";
import { Mongodb } from "@/shared/components/ui/svgs/mongodb";
import { Mysql } from "@/shared/components/ui/svgs/mysql";
import { N8n } from "@/shared/components/ui/svgs/n8n";
import { Nats } from "@/shared/components/ui/svgs/nats";
import { Nocodb } from "@/shared/components/ui/svgs/nocodb";
import { Nodejs } from "@/shared/components/ui/svgs/nodejs";
import { Ntfy } from "@/shared/components/ui/svgs/ntfy";
import { Ollama } from "@/shared/components/ui/svgs/ollama";
import { Plausible } from "@/shared/components/ui/svgs/plausible";
import { Pocketbase } from "@/shared/components/ui/svgs/pocketbase";
import { Postgresql } from "@/shared/components/ui/svgs/postgresql";
import { Python } from "@/shared/components/ui/svgs/python";
import { Rabbitmq } from "@/shared/components/ui/svgs/rabbitmq";
import { Redis } from "@/shared/components/ui/svgs/redis";
import { Ruby } from "@/shared/components/ui/svgs/ruby";
import { Rust } from "@/shared/components/ui/svgs/rust";
import { Rustfs } from "@/shared/components/ui/svgs/rustfs";
import { Temporal } from "@/shared/components/ui/svgs/temporal";
import { Twenty } from "@/shared/components/ui/svgs/twenty";
import { Umami } from "@/shared/components/ui/svgs/umami";
import { UptimeKuma } from "@/shared/components/ui/svgs/uptime-kuma";
import { Vaultwarden } from "@/shared/components/ui/svgs/vaultwarden";
import { Verdaccio } from "@/shared/components/ui/svgs/verdaccio";
import { Wordpress } from "@/shared/components/ui/svgs/wordpress";
import { cn } from "@/shared/lib/utils";

type BrandSvg = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Image ref → brand mark. Keys are matched (in order) against the full repo
 * path, the bare image name, and the owner, so one entry covers the shapes a
 * compose file actually uses: `vaultwarden/server` matches on the owner,
 * `n8nio/n8n` on the name, `library/postgres:16` on the name.
 */
const IMAGE_BRANDS: Record<string, BrandSvg> = {
  // Data stores + queues.
  postgres: Postgresql,
  postgresql: Postgresql,
  pgvector: Postgresql,
  mysql: Mysql,
  mariadb: Mariadb,
  mongo: Mongodb,
  mongodb: Mongodb,
  redis: Redis,
  valkey: Redis,
  rabbitmq: Rabbitmq,
  nats: Nats,
  minio: Minio,
  rustfs: Rustfs,
  meilisearch: Meilisearch,
  // Language runtimes (build-from-source bases).
  node: Nodejs,
  nodejs: Nodejs,
  python: Python,
  go: Go,
  golang: Go,
  rust: Rust,
  ruby: Ruby,
  bun: BunLogo,
  oven: BunLogo,
  // Self-hosted apps that show up as stack members.
  authentik: Authentik,
  // `ghcr.io/goauthentik/server` keys as owner "goauthentik", never
  // "authentik" — without this the running stack fell back to the neutral
  // glyph while the catalog (keyed by app name) showed the brand.
  goauthentik: Authentik,
  dozzle: Dozzle,
  "it-tools": ItTools,
  // `ghcr.io/drizzle-team/gateway` keys as "drizzle-team/gateway", bare
  // "gateway", owner "drizzle-team" — only the owner is distinctive.
  "drizzle-team": Drizzle,
  baserow: Baserow,
  cloudbeaver: Dbeaver,
  dbeaver: Dbeaver,
  directus: Directus,
  "eclipse-mosquitto": EclipseMosquitto,
  excalidraw: Excalidraw,
  forgejo: Forgejo,
  ghost: Ghost,
  gitea: Gitea,
  gitlab: Gitlab,
  grafana: Grafana,
  harbor: Harbor,
  hasura: Hasura,
  hoppscotch: Hoppscotch,
  jaeger: Jaeger,
  jaegertracing: Jaeger,
  keycloak: Keycloak,
  libretranslate: Libretranslate,
  listmonk: Listmonk,
  matomo: Matomo,
  metabase: Metabase,
  n8n: N8n,
  n8nio: N8n,
  nocodb: Nocodb,
  ntfy: Ntfy,
  ollama: Ollama,
  plausible: Plausible,
  pocketbase: Pocketbase,
  temporal: Temporal,
  twenty: Twenty,
  twentycrm: Twenty,
  umami: Umami,
  "uptime-kuma": UptimeKuma,
  vaultwarden: Vaultwarden,
  verdaccio: Verdaccio,
  wordpress: Wordpress,
};

// Marks whose SVG is solid black (#000000), invisible on the dark canvas. The
// color-branded ones (Postgres, Redis, Grafana, …) and the `currentColor` ones
// (Ghost, Umami, Twenty) are left alone.
const DARK_INVERT = new Set(["rust", "bun", "oven", "ollama", "temporal"]);

/**
 * Lookup keys for an image ref, most specific first: full repo path, bare
 * name, owner. Registry host, tag and digest are stripped first, so
 * `ghcr.io/umami-software/umami:latest` yields
 * `umami-software/umami`, `umami`, `umami-software`.
 */
function imageKeys(image: string): string[] {
  const [ref = ""] = image.split("@");
  const parts = ref.toLowerCase().split("/");
  // A registry host is the leading segment carrying a dot or a port. A bare
  // `postgres:16` has neither a leading segment nor a host, hence the guard.
  if (parts.length > 1 && /[.:]/.test(parts[0] ?? "")) parts.shift();
  // Docker Hub's implicit namespace: `library/postgres` === `postgres`.
  if (parts.length > 1 && parts[0] === "library") parts.shift();
  const [name = ""] = (parts.at(-1) ?? "").split(":");
  const path = [...parts.slice(0, -1), name].join("/");
  const owner = parts.length > 1 ? (parts[0] ?? "") : "";
  return [path, name, owner].filter(Boolean);
}

export function resolveImageBrand(
  image: string | null | undefined,
): { Icon: BrandSvg; invertInDark: boolean } | null {
  if (!image) return null;
  for (const key of imageKeys(image)) {
    const Icon = IMAGE_BRANDS[key];
    if (Icon) return { Icon, invertInDark: DARK_INVERT.has(key) };
  }
  return null;
}

/** Whether the ref resolves to a known brand mark. Callers that have their own
 *  fallback (e.g. the tinted kind icon) gate on this instead of accepting
 *  `ServiceImageIcon`'s neutral container glyph. */
export function hasImageBrand(image: string | null | undefined): boolean {
  return resolveImageBrand(image) != null;
}

/** The identity glyph alone: brand mark when we recognise the image, neutral
 *  shipping container when we don't (including build-from-source services,
 *  which have no image yet). */
export function ServiceImageIcon({
  image,
  className,
}: {
  image: string | null | undefined;
  className?: string;
}) {
  const brand = resolveImageBrand(image);
  if (!brand) {
    return (
      <HugeiconsIcon
        icon={ContainerIcon}
        strokeWidth={1.8}
        className={cn("text-muted-foreground", className)}
        aria-hidden
      />
    );
  }
  const { Icon, invertInDark } = brand;
  return <Icon className={cn(invertInDark && "dark:invert", className)} aria-hidden />;
}

/** Identity glyph on a tile, with the Docker runtime badge tucked into the
 *  bottom-right corner. Decorative: the row beside it always carries the name. */
export function ServiceImageTile({
  image,
  className,
}: {
  image: string | null | undefined;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative grid size-7 shrink-0 place-items-center rounded-lg border bg-background",
        className,
      )}
    >
      <ServiceImageIcon image={image} className="size-4" />
      <span
        className="absolute -right-1 -bottom-1 grid size-3.5 place-items-center rounded-full bg-background ring-1 ring-border"
        aria-hidden
      >
        <Docker className="size-2.5" />
      </span>
    </span>
  );
}
