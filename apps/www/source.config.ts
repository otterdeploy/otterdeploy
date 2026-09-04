import { pageSchema } from "fumadocs-core/source/schema";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import lastModified from "fumadocs-mdx/plugins/last-modified";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema.extend({
      // Navigation labels should remain short. Pages that need a more
      // descriptive search-result title can opt in without changing the H1 or
      // sidebar label.
      seoTitle: pageSchema.shape.title.optional(),
    }),
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
  // The plugin reports Git's best available date. A shallow clone can make its
  // boundary commit look like every unchanged file's latest commit, so the app
  // publishes these dates only when Vite proves that history is complete.
  plugins: [lastModified()],
});
