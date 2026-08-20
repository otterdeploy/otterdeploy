import { createServerFn } from "@tanstack/react-start";
import { createFileRoute, notFound } from "@tanstack/react-router";
import browserCollections from "collections/browser";
import type { PageData } from "fumadocs-core/source";
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
import { breadcrumbJsonLd, canonical, seo } from "@/lib/seo";
import { docsRoute } from "@/lib/shared";
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
  // Per-page title, description and canonical. Without this every docs page
  // shares the root's tags, so search engines see one title across the whole
  // reference and dedupe most of it away.
  head: ({ loaderData }) => {
    const path = loaderData?.url ?? docsRoute;
    return {
      meta: seo({
        title: loaderData?.title,
        description: loaderData?.description,
        path,
        type: "article",
      }),
      links: [canonical(path)],
      // A breadcrumb trail in the result instead of a bare URL. Only for
      // pages that resolved: a 404 has no trail worth describing.
      scripts: loaderData?.title
        ? [
            {
              type: "application/ld+json",
              children: breadcrumbJsonLd(path, loaderData.title),
            },
          ]
        : [],
    };
  },
});

// `staticSource` widens the page-data union to `PageData`; this recovers the
// OpenAPI shape the `openapi` page type guarantees at runtime by checking for
// its distinguishing member.
function isOpenAPIPageData(data: PageData): data is OpenAPIPageData {
  return "getOpenAPIPageProps" in data && typeof data.getOpenAPIPageProps === "function";
}

const serverLoader = createServerFn({ method: "GET" })
  .validator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs);
    if (!page) throw notFound();

    const pageTree = await source.serializePageTree(source.getPageTree());

    // OpenAPI pages are virtual (no MDX collection). Hand the renderer its
    // resolved props directly instead of going through the client loader.
    if (page.type === "openapi") {
      const data = page.data;
      if (!isOpenAPIPageData(data)) {
        throw new Error(`openapi page ${page.url} is missing its OpenAPI render data`);
      }
      return {
        type: "openapi" as const,
        title: data.title,
        description: data.description,
        url: page.url,
        pageTree,
        props: data.getOpenAPIPageProps(),
      };
    }

    // `title` / `description` are surfaced for the head tags. The body still
    // renders them from the client loader's frontmatter. These are the same
    // values, read on the server so the crawler sees them in the HTML rather
    // than after hydration.
    const data = page.data;
    return {
      type: "docs" as const,
      path: page.path,
      url: page.url,
      title: data.title,
      description: data.description,
      pageTree,
    };
  });

// Our MDX overrides are a static map (`getMDXComponents` is a plain function,
// not a real hook), so resolve them once at module scope. This also keeps the
// renderer callback below free of any `use*`-shaped call. Fumadocs invokes it
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

// `--fd-banner-height` offsets the docs sidebar/TOC below our marketing bar,
// so the layout reads as: marketing bar on top, then sidebar + content (the
// Better Auth structure). 3.5rem == the bar's h-14.
const docsShellStyle: React.CSSProperties & { "--fd-banner-height": string } = {
  "--fd-banner-height": "3.5rem",
};

function Page() {
  const page = useFumadocsLoader(Route.useLoaderData());

  return (
    <div style={docsShellStyle}>
      <SiteBar />
      <DocsLayout
        {...baseOptions()}
        tree={page.pageTree}
        sidebar={{ banner: <DocsVersion /> }}
        // The site bar above already carries a theme toggle. Fumadocs draws its
        // own at the foot of the sidebar, so a docs page showed two.
        themeSwitch={{ enabled: false }}
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
