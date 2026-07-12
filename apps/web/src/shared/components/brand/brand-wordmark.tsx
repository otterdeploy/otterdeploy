import type { ReactNode, SVGProps } from "react";

import { useTheme } from "@/shared/components/theme-provider";
import { GithubWordmarkDark } from "@/shared/components/ui/svgs/github-wordmark-dark";
import { GithubWordmarkLight } from "@/shared/components/ui/svgs/github-wordmark-light";
import { MongodbWordmarkDark } from "@/shared/components/ui/svgs/mongodb-wordmark-dark";
import { MongodbWordmarkLight } from "@/shared/components/ui/svgs/mongodb-wordmark-light";
import { MysqlWordmarkDark } from "@/shared/components/ui/svgs/mysql-wordmark-dark";
import { MysqlWordmarkLight } from "@/shared/components/ui/svgs/mysql-wordmark-light";
import { PostgresqlWordmarkDark } from "@/shared/components/ui/svgs/postgresql-wordmark-dark";
import { PostgresqlWordmarkLight } from "@/shared/components/ui/svgs/postgresql-wordmark-light";
import { SlackWordmark } from "@/shared/components/ui/svgs/slack-wordmark";

/** Brands with a full wordmark/lockup asset (not just the square mark). */
export type WordmarkBrand = "github" | "mongodb" | "mysql" | "postgresql" | "slack";

type SvgComponent = (props: SVGProps<SVGSVGElement>) => ReactNode;

/**
 * Theme-flipping wordmark pairs. Slack isn't here: its lockup is a single
 * asset whose text uses `currentColor`, so it adapts without a pair.
 */
const themedWordmarks: Record<
  Exclude<WordmarkBrand, "slack">,
  { dark: SvgComponent; light: SvgComponent }
> = {
  github: { dark: GithubWordmarkDark, light: GithubWordmarkLight },
  mongodb: { dark: MongodbWordmarkDark, light: MongodbWordmarkLight },
  mysql: { dark: MysqlWordmarkDark, light: MysqlWordmarkLight },
  postgresql: { dark: PostgresqlWordmarkDark, light: PostgresqlWordmarkLight },
};

export interface BrandWordmarkProps extends SVGProps<SVGSVGElement> {
  brand: WordmarkBrand;
}

/**
 * Full brand wordmark (logo + logotype lockup), theme-aware.
 *
 * Unlike `SvglLogo` / `DatabaseLogo` — which render a square mark inside a
 * tile and take a free-form `search`/`value` string — this renders the bare
 * SVG lockup for the closed set of brands we have wordmark art for. Size it
 * with `height` (or a Tailwind `h-*` class); each asset keeps its own aspect
 * ratio via its viewBox.
 *
 * Follows the OS when theme="system" (next-themes' `resolvedTheme`).
 *
 * @example
 * <BrandWordmark brand="postgresql" className="h-6 w-auto" />
 */
export function BrandWordmark({ brand, ...props }: BrandWordmarkProps) {
  const { resolvedTheme, theme } = useTheme();
  const isDark = (resolvedTheme ?? theme) === "dark";

  if (brand === "slack") {
    return <SlackWordmark {...props} />;
  }

  const Wordmark = isDark ? themedWordmarks[brand].dark : themedWordmarks[brand].light;
  return <Wordmark {...props} />;
}
