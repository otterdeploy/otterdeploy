/**
 * Brand icon for a detected compose service, keyed off its image name. Reuses
 * the same brand SVGs the graph + resource cards use. Falls back to a generic
 * Docker mark for unknown images / build-from-source services.
 */
import type { ComponentType, SVGProps } from "react";

import { BunLogo } from "@/shared/components/ui/svgs/bun";
import { Docker } from "@/shared/components/ui/svgs/docker";
import { Go } from "@/shared/components/ui/svgs/go";
import { Mariadb } from "@/shared/components/ui/svgs/mariadb";
import { Mongodb } from "@/shared/components/ui/svgs/mongodb";
import { Mysql } from "@/shared/components/ui/svgs/mysql";
import { Nodejs } from "@/shared/components/ui/svgs/nodejs";
import { Postgresql } from "@/shared/components/ui/svgs/postgresql";
import { Python } from "@/shared/components/ui/svgs/python";
import { Redis } from "@/shared/components/ui/svgs/redis";
import { Ruby } from "@/shared/components/ui/svgs/ruby";
import { Rust } from "@/shared/components/ui/svgs/rust";

type BrandSvg = ComponentType<SVGProps<SVGSVGElement>>;

// Image base name (no registry/tag) → brand mark.
const IMAGE_ICONS: Record<string, BrandSvg> = {
  postgres: Postgresql,
  postgresql: Postgresql,
  mysql: Mysql,
  mariadb: Mariadb,
  mongo: Mongodb,
  mongodb: Mongodb,
  redis: Redis,
  node: Nodejs,
  nodejs: Nodejs,
  python: Python,
  go: Go,
  golang: Go,
  rust: Rust,
  ruby: Ruby,
  bun: BunLogo,
};

export function ComposeServiceIcon({
  image,
  className,
}: {
  image: string | null;
  className?: string;
}) {
  // `postgres`, `ghcr.io/acme/redis:7`, `library/node:20` → `postgres`/`redis`/`node`.
  const base =
    image?.split("@")[0]?.split(":")[0]?.split("/").pop()?.toLowerCase() ?? "";
  const Icon = IMAGE_ICONS[base] ?? Docker;
  return <Icon className={className} />;
}
