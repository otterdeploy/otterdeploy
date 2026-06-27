import { createServerFn } from "@tanstack/react-start";
import { createFileRoute, notFound } from "@tanstack/react-router";
import browserCollections from "collections/browser";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import type { OpenAPIPageData } from "fumadocs-openapi/server";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import type React from "react";
import { Suspense } from "react";
import { OpenAPIPage } from "@/components/api-page";
import { DocsVersion } from "@/components/docs-version";
import { getMDXComponents } from "@/components/mdx";
import { SiteBar } from "@/components/site-bar";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";

export const Route = createFileRoute("/docs/$")({
  component: Page,
  loader: async ({ params }) => {
    const slugs = params._splat?.split("/") ?? [];
    const data = await serverLoader({ data: slugs });
    if (data.type === "docs") {
      await clientLoader.preload(data.path);
    }
    return data;
  },
});

const serverLoader = createServerFn({ method: "GET" })
  .validator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs);
    if (!page) throw notFound();

    const pageTree = await source.serializePageTree(source.getPageTree());

    // OpenAPI pages are virtual (no MDX collection) — hand the renderer its
    // resolved props directly instead of going through the client loader.
    // `staticSource` widens the union to `PageData`, so narrow the data to the
    // OpenAPI shape the `openapi` page type guarantees at runtime.
    if (page.type === "openapi") {
      const data = page.data as OpenAPIPageData;
      return {
        type: "openapi" as const,
        title: data.title,
        description: data.description,
        pageTree,
        props: data.getOpenAPIPageProps(),
      };
    }

    return {
      type: "docs" as const,
      path: page.path,
      pageTree,
    };
  });

// Our MDX overrides are a static map (`getMDXComponents` is a plain function,
// not a real hook), so resolve them once at module scope. This also keeps the
// renderer callback below free of any `use*`-shaped call — fumadocs invokes it
// inside its own internal `Renderer`, which a hooks linter can't see as a
// component boundary.
const mdxComponents = getMDXComponents();

const clientLoader = browserCollections.docs.createClientLoader({
  component({ toc, frontmatter, default: MDX }) {
    return (
      <DocsPage toc={toc}>
        <DocsTitle>{frontmatter.title}</DocsTitle>
        <DocsDescription>{frontmatter.description}</DocsDescription>
        <DocsBody>
          <MDX components={mdxComponents} />
        </DocsBody>
      </DocsPage>
    );
  },
});

// Calling `clientLoader.useContent` (a hook) directly inside the render ternary
// below would break the rules of hooks (conditional call). Wrap it in its own
// component so the hook runs unconditionally at that component's top level; the
// component itself is then what we render conditionally, which is allowed.
function DocsContent({ path }: { path: string }) {
  return clientLoader.useContent(path);
}

function Page() {
  const page = useFumadocsLoader(Route.useLoaderData());

  // `--fd-banner-height` offsets the docs sidebar/TOC below our marketing bar,
  // so the layout reads as: marketing bar on top, then sidebar + content (the
  // Better Auth structure). 3.5rem == the bar's h-14.
  return (
    <div style={{ "--fd-banner-height": "3.5rem" } as React.CSSProperties}>
      <SiteBar />
      <DocsLayout
        {...baseOptions()}
        tree={page.pageTree}
        sidebar={{ banner: <DocsVersion /> }}
      >
        {page.type === "openapi" ? (
          <DocsPage full>
            <DocsTitle>{page.title}</DocsTitle>
            <DocsDescription>{page.description}</DocsDescription>
            <DocsBody>
              <OpenAPIPage {...page.props} />
            </DocsBody>
          </DocsPage>
        ) : (
          <Suspense>
            <DocsContent path={page.path} />
          </Suspense>
        )}
      </DocsLayout>
    </div>
  );
}
