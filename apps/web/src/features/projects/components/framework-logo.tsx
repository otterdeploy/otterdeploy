/**
 * Maps a detected framework (the enum on `git.inspectRepo`'s output) to
 * its brand SVG. The mark renders inside the graph node's 26px header
 * tile in place of the generic kind icon when a framework was detected
 * for a service.
 *
 * "hono" doesn't ship a simple-icons SVG and falls through to the
 * generic Node mark — close enough since Hono is a Node/Bun framework.
 * "static" routes to HTML5.
 */

import type { SVGProps } from "react";

import { Astro } from "@/shared/components/ui/svgs/astro";
import { BunLogo } from "@/shared/components/ui/svgs/bun";
import { Express } from "@/shared/components/ui/svgs/express";
import { Fastify } from "@/shared/components/ui/svgs/fastify";
import { Go } from "@/shared/components/ui/svgs/go";
import { Html5 } from "@/shared/components/ui/svgs/html5";
import { Nestjs } from "@/shared/components/ui/svgs/nestjs";
import { Nextjs } from "@/shared/components/ui/svgs/nextjs";
import { Nodejs } from "@/shared/components/ui/svgs/nodejs";
import { Nuxt } from "@/shared/components/ui/svgs/nuxt";
import { Python } from "@/shared/components/ui/svgs/python";
import { ReactLogo } from "@/shared/components/ui/svgs/react";
import { Remix } from "@/shared/components/ui/svgs/remix";
import { Ruby } from "@/shared/components/ui/svgs/ruby";
import { Rust } from "@/shared/components/ui/svgs/rust";
import { Svelte } from "@/shared/components/ui/svgs/svelte";
import { Vite } from "@/shared/components/ui/svgs/vite";
import { Vuejs } from "@/shared/components/ui/svgs/vuejs";

export type FrameworkKind =
  | "next"
  | "nuxt"
  | "vite"
  | "remix"
  | "astro"
  | "sveltekit"
  | "react"
  | "vue"
  | "express"
  | "fastify"
  | "hono"
  | "nest"
  | "node"
  | "bun"
  | "go"
  | "python"
  | "rust"
  | "ruby"
  | "static";

type BrandSvg = (props: SVGProps<SVGSVGElement>) => React.ReactNode;

const FRAMEWORK_SVGS: Record<FrameworkKind, BrandSvg> = {
  next: Nextjs,
  nuxt: Nuxt,
  vite: Vite,
  remix: Remix,
  astro: Astro,
  sveltekit: Svelte,
  react: ReactLogo,
  vue: Vuejs,
  express: Express,
  fastify: Fastify,
  hono: Nodejs, // no brand mark on simple-icons; Hono runs on Node/Bun
  nest: Nestjs,
  node: Nodejs,
  bun: BunLogo,
  go: Go,
  python: Python,
  rust: Rust,
  ruby: Ruby,
  static: Html5,
};

const FRAMEWORK_LABELS: Record<FrameworkKind, string> = {
  next: "Next.js",
  nuxt: "Nuxt",
  vite: "Vite",
  remix: "Remix",
  astro: "Astro",
  sveltekit: "SvelteKit",
  react: "React",
  vue: "Vue",
  express: "Express",
  fastify: "Fastify",
  hono: "Hono",
  nest: "NestJS",
  node: "Node.js",
  bun: "Bun",
  go: "Go",
  python: "Python",
  rust: "Rust",
  ruby: "Ruby",
  static: "Static",
};

export function frameworkLabel(framework: FrameworkKind): string {
  return FRAMEWORK_LABELS[framework];
}

export function FrameworkLogo({
  framework,
  ...props
}: { framework: FrameworkKind } & SVGProps<SVGSVGElement>) {
  const Logo = FRAMEWORK_SVGS[framework];
  return <Logo aria-label={FRAMEWORK_LABELS[framework]} {...props} />;
}
