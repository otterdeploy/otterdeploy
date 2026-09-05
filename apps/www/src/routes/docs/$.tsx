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
  PageLastUpdate,
} from "fumadocs-ui/layouts/docs/page";
import type React from "react";
import { Suspense } from "react";
import { OpenAPIPage } from "@/components/api-page";
import { DocsVersion } from "@/components/docs-version";
import { GITHUB_URL } from "@/components/landing/content";
import { getMDXComponents } from "@/components/mdx";
import { SiteBar } from "@/components/site-bar";
import { baseOptions } from "@/lib/layout.shared";
import { breadcrumbJsonLd, canonical, notFoundSeo, seo, seoTitleOf } from "@/lib/seo";
import { docsRoute } from "@/lib/shared";
import { sourceForDocs } from "@/lib/source";

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
  head: ({ loaderData, match }) => {
    if (match.status === "notFound") {
      return { meta: notFoundSeo(), links: [], scripts: [] };
    }

    const path = loaderData?.url ?? docsRoute;
    return {
      meta: seo({
        title: loaderData ? seoTitleOf(loaderData) : undefined,
        description: loaderData?.description,
        path,
        type: "article",
        // Hundreds of generated operation URLs are useful to a person already
        // browsing the reference, but premature crawl/index expansion for a
        // new site. The authored /docs/openapi overview remains indexable.
        indexable: loaderData?.type !== "openapi",
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
    const source = await sourceForDocs(slugs);
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
        // OpenAPI page titles are optional in Fumadocs' type. Keep the route
        // renderable and its noindex metadata meaningful for malformed or
        // unusually sparse upstream operation metadata.
        title:
          data.title ??
          `${data._openapi.method?.toUpperCase() ?? "API"} ${page.url.replace(`${docsRoute}/openapi`, "")}`,
        seoTitle: undefined,
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
      seoTitle: data.seoTitle,
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
const docsSourceRoot = `${GITHUB_URL}/blob/main/apps/www/content/docs`;

const clientLoader = browserCollections.docs.createClientLoader<{ sourcePath: string }>({
  component({ toc, frontmatter, lastModified, default: MDX }, { sourcePath }) {
    return (
      <DocsPage toc={toc} role="main">
        <DocsTitle>{frontmatter.title}</DocsTitle>
        <DocsDescription>{frontmatter.description}</DocsDescription>
        <DocsBody>
          <MDX components={mdxComponents} />
        </DocsBody>
        {__DOCS_GIT_HISTORY_COMPLETE__ && lastModified && (
          <PageLastUpdate date={lastModified} />
        )}
        <p className="mt-6 border-t border-border pt-5 text-xs text-muted-foreground">
          Maintained in the public otterdeploy repository.{" "}
          <a
            href={`${docsSourceRoot}/${sourcePath.replace(/^\/+/, "")}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            View this page’s source ↗
          </a>
        </p>
      </DocsPage>
    );
  },
});

// Calling `clientLoader.useContent` (a hook) directly inside the render ternary
// below would break the rules of hooks (conditional call). Wrap it in its own
// component so the hook runs unconditionally at that component's top level; the
// component itself is then what we render conditionally, which is allowed.
function DocsContent({ path }: { path: string }) {
  return clientLoader.useContent(path, { sourcePath: path });
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
          <DocsPage full role="main">
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
