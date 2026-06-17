import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { gitConfig } from "./shared";

// The wordmark and primary links live in the marketing <SiteBar /> above the
// docs layout (Better Auth structure), so the Fumadocs sidebar only needs its
// own search + nav tree + the GitHub/theme controls at its foot. Hiding the
// nav title keeps the wordmark from showing twice.
export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: null },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
