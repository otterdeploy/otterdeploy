import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { RootProvider } from "fumadocs-ui/provider/tanstack";

import { notFoundSeo } from "@/lib/seo";
import appCss from "@/styles/app.css?url";

/**
 * Document shell.
 *
 * The icon, manifest and theme-color tags live here rather than per route.
 * They're properties of the site, not of a page. Titles, descriptions and
 * canonical links are per route (see lib/seo.ts). The root intentionally has
 * no page defaults: inheriting the home page's og:url on a true 404 falsely
 * attributes that missing URL to `/`.
 */
export const Route = createRootRoute({
  head: ({ match }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      ...(match.globalNotFound || match.status === "notFound" ? notFoundSeo() : []),
    ],
    links: [
      { rel: "stylesheet", href: appCss },

      // Modern browsers take the SVG and scale it themselves; it carries its
      // own prefers-color-scheme rule so the mark stays legible on dark tab
      // bars. The .ico is the legacy fallback (and stops /favicon.ico 404s).
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { rel: "icon", href: "/favicon-96x96.png", type: "image/png", sizes: "96x96" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html suppressHydrationWarning lang="en">
      <head>
        {/* Written here, not through the head API: React dedupes hoisted
            <meta> by `name`, so a light/dark pair routed through `meta:` loses
            one of the two and the browser chrome ends up wrong in whichever
            theme got dropped. Rendered inside <head> directly, both survive. */}
        <meta name="theme-color" content="#fbfbfa" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0c0c0b" media="(prefers-color-scheme: dark)" />
        <HeadContent />
      </head>
      <body className="flex min-h-screen flex-col">
        <RootProvider>
          <Outlet />
        </RootProvider>
        <Scripts />
      </body>
    </html>
  );
}
