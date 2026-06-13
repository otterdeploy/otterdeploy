/**
 * Mock the fields `ResourceNodeData` doesn't carry yet — derived from
 * the node's name so each one looks plausible per-service. Used only by
 * the demo panel cluster; real resources skip this entirely.
 */

import type { ResourceNodeData } from "@/features/projects/components/graph/resource-node";

export interface DemoMeta {
  repo: string;
  domain: string | null;
  port: number | null;
  image: string;
  replicas: number;
  region: string;
  cpu: number;
  memory: number;
  rps: number | null;
  deployedAt: string;
}

export function demoMeta(node: ResourceNodeData): DemoMeta {
  const slug = node.name.replace(/[^a-z0-9-]/gi, "-");
  const isService = node.kind === "service";
  const tech = node.tech?.label ?? "—";
  return {
    repo: `paperhouse/helio-${slug}`,
    domain: isService ? `${slug}.helio.so` : null,
    port: isService ? 8080 : null,
    image: imageForTech(tech),
    replicas: 1,
    region: "sf-bay / rack-2",
    cpu: 51,
    memory: 48,
    rps: isService ? 1180 : null,
    deployedAt: "2:06",
  };
}

function imageForTech(tech: string): string {
  if (tech.includes("Node")) return "node:24-alpine";
  if (tech.includes("Bun")) return "oven/bun:1.3";
  if (tech.includes("Go")) return "golang:1.23-alpine";
  if (tech.includes("Postgres")) return "postgres:16-alpine";
  if (tech.includes("Redis")) return "redis:7-alpine";
  if (tech.includes("MongoDB")) return "mongo:7";
  if (tech.includes("MySQL")) return "mysql:8.4";
  if (tech.includes("MariaDB")) return "mariadb:11.4";
  return tech.toLowerCase();
}
