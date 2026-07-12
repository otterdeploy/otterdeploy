import type { Rocket01Icon } from "@hugeicons/core-free-icons";
import type { LinkProps } from "@tanstack/react-router";

export type RoutePath = LinkProps["to"];
export type Status = "ok" | "warn" | "err";

export interface NavItem {
  /** i18n key resolved at render time, e.g. "nav.overview". */
  titleKey: string;
  href: RoutePath;
  icon: typeof Rocket01Icon;
  badge?: string;
  active?: boolean;
}
