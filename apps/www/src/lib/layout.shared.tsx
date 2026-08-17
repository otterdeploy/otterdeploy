import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

/**
 * The wordmark, the nav links, the GitHub link and the theme toggle all live in
 * the marketing `<SiteBar />` above the docs layout. Fumadocs would render its
 * own copy of each at the foot of the sidebar, which is why the docs page used
 * to show two GitHub icons and two theme toggles at once.
 *
 * So: no nav title (the wordmark is already up there), and no `githubUrl`.
 * Passing one is what makes Fumadocs draw the sidebar's GitHub button. The
 * theme toggle is switched off where the layout is rendered, in routes/docs.
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: null },
  };
}
