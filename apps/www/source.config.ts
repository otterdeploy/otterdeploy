import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import lastModified from "fumadocs-mdx/plugins/last-modified";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    postprocess: {
      // Keeps the processed Markdown on the page data, which is what
      // /llms-full.txt serves to model crawlers.
      includeProcessedMarkdown: true,
    },
  },
});

export default defineConfig({
  // Stamps each page with its last git commit date, so /sitemap.xml can carry
  // a real <lastmod>. Without it crawlers have no signal for what changed and
  // recrawl the whole site on their own slow schedule.
  //
  // Needs git history at build time: a shallow clone (`--depth 1`) leaves the
  // date undefined, and the sitemap then omits <lastmod> for that page rather
  // than inventing one.
  plugins: [lastModified()],
});
