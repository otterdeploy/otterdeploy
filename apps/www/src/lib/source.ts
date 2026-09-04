import { createElement } from "react";

import {
  Album02Icon,
  BookOpen01Icon,
  PlugSocketIcon,
  Rocket01Icon,
  SourceCodeIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { docs } from "collections/server";
import { loader } from "fumadocs-core/source";

import { openapi } from "./openapi";
import { OPENAPI_PAGE_OPTIONS } from "./openapi-pages";
import { docsRoute } from "./shared";

// Resolve docs `icon:` frontmatter to Hugeicons (we use Hugeicons everywhere,
// no lucide). Keys stay the semantic names used in the .mdx frontmatter.
//
// Icons mark SECTIONS, not pages. A distinct icon per folder is a wayfinding
// aid; the same three icons scattered across every leaf page underneath is
// just noise, so leaf pages deliberately carry no `icon:` frontmatter.
const DOC_ICONS: Record<string, typeof Album02Icon> = {
  Album: Album02Icon,
  Rocket: Rocket01Icon,
  Book: BookOpen01Icon,
  Terminal: TerminalIcon,
  Code: SourceCodeIcon,
  Api: PlugSocketIcon,
};

async function loadOpenAPISource(): Promise<Awaited<ReturnType<typeof openapi.staticSource>>> {
  try {
    return await openapi.staticSource(OPENAPI_PAGE_OPTIONS);
  } catch (error) {
    // The Vite boundary has already fetched and structurally validated this
    // snapshot. This second boundary protects the reference overview if
    // Fumadocs cannot bundle or generate pages from it. The stable
    // /docs/openapi MDX page remains available, while the diagnostic keeps the
    // failure visible in Worker logs.
    // oxlint-disable-next-line no-console -- no application logger exists at this server init boundary
    console.error("[www] OpenAPI operation pages were not generated", error);
    return { files: [] };
  }
}

type OpenAPISource = Awaited<ReturnType<typeof openapi.staticSource>>;

function createSource(openapiSource: OpenAPISource) {
  return loader(
    {
      docs: docs.toFumadocsSource(),
      // Virtual pages generated from the OpenAPI snapshot captured when Vite
      // started. `baseDir: "openapi"` mounts the reference under
      // /docs/openapi/*; one page per operation, grouped into folders by route
      // (the oRPC spec only tags a few operations, so `groupBy: "route"` keeps
      // every endpoint browsable without tags). Each page carries schemas and
      // request examples; `openapi.loaderPlugin` attaches the
      // `getOpenAPIPageProps()` render data.
      openapi: openapiSource,
    },
    {
      baseUrl: docsRoute,
      plugins: [openapi.loaderPlugin()],
      icon(name) {
        const icon = name ? DOC_ICONS[name] : undefined;
        return icon ? createElement(HugeiconsIcon, { icon }) : undefined;
      },
    },
  );
}

// Authored pages are cheap and sufficient for search, sitemaps, and llms.txt.
// In particular, constructing those indexes must not force hundreds of
// generated API pages into either the index or a Worker's startup path.
export const source = createSource({ files: [] });

let openAPISourcePromise: Promise<ReturnType<typeof createSource>> | undefined;

/**
 * Load the generated reference only while serving its own section. Vite and
 * Rollup preserve arbitrary top-level awaits in the server bundle; eagerly
 * calling `staticSource()` here would therefore bundle/upgrade the full schema
 * and create every operation page during each Cloudflare Worker isolate's
 * startup. Memoizing on first API-reference access moves that work into a
 * normal request and pays it at most once per isolate.
 */
export function sourceForDocs(slugs: readonly string[]): Promise<ReturnType<typeof createSource>> {
  if (slugs[0] !== "openapi") return Promise.resolve(source);

  openAPISourcePromise ??= loadOpenAPISource().then(createSource);
  return openAPISourcePromise;
}
