import { createElement } from "react";

import { Album02Icon, Rocket01Icon, TerminalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { docs } from "collections/server";
import { loader } from "fumadocs-core/source";

import { openapi } from "./openapi";
import { docsRoute } from "./shared";

// Resolve docs `icon:` frontmatter to Hugeicons (we use Hugeicons everywhere —
// no lucide). Keys stay the semantic names used in the .mdx frontmatter.
const DOC_ICONS: Record<string, typeof Album02Icon> = {
  Album: Album02Icon,
  Rocket: Rocket01Icon,
  Terminal: TerminalIcon,
};

export const source = loader(
  {
    docs: docs.toFumadocsSource(),
    // Virtual pages generated from the live OpenAPI spec. `baseDir: "openapi"`
    // mounts the reference under /docs/openapi/*; one page per operation,
    // grouped into folders by route (the oRPC spec only tags a few operations,
    // so `groupBy: "route"` keeps every endpoint browsable without tags). Each
    // page carries an interactive playground; `openapi.loaderPlugin` attaches
    // the `getOpenAPIPageProps()` render data.
    openapi: await openapi.staticSource({
      baseDir: "openapi",
      per: "operation",
      groupBy: "route",
    }),
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
