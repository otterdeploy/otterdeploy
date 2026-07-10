import type { SVGProps } from "react";

import { useTheme } from "@/shared/components/theme-provider";

import { MariadbDark } from "./mariadb-dark";
import { MariadbLight } from "./mariadb-light";

/**
 * Theme-aware MariaDB seal — the navy body (#002B64) vanishes on the dark
 * canvas, so this delegates to the dark/light pair (MariaDB's reversed
 * lockup: navy → white, tan seal unchanged). Prefer importing `MariadbDark`
 * / `MariadbLight` directly when the caller already knows the resolved theme
 * (e.g. the `DatabaseLogo` brand resolver).
 */
const Mariadb = (props: SVGProps<SVGSVGElement>) => {
  const { resolvedTheme, theme } = useTheme();
  const isDark = (resolvedTheme ?? theme) === "dark";
  return isDark ? <MariadbDark {...props} /> : <MariadbLight {...props} />;
};

export { Mariadb };
