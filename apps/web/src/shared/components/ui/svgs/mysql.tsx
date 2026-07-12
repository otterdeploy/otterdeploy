import type { SVGProps } from "react";

import { useTheme } from "@/shared/components/theme-provider";

import { MysqlDark } from "./mysql-dark";
import { MysqlLight } from "./mysql-light";

/**
 * Theme-aware MySQL dolphin — the brand teal (#00546B) vanishes on the dark
 * canvas, so this delegates to the dark/light pair. Prefer importing
 * `MysqlDark` / `MysqlLight` directly when the caller already knows the
 * resolved theme (e.g. the `DatabaseLogo` brand resolver).
 */
export const Mysql = (props: SVGProps<SVGSVGElement>) => {
  const { resolvedTheme, theme } = useTheme();
  const isDark = (resolvedTheme ?? theme) === "dark";
  return isDark ? <MysqlDark {...props} /> : <MysqlLight {...props} />;
};
