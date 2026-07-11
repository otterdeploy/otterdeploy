import type { SVGProps } from "react";

import { useTheme } from "@/shared/components/theme-provider";

import { MongodbDark } from "./mongodb-dark";
import { MongodbLight } from "./mongodb-light";

/**
 * Theme-aware MongoDB leaf — the brand ink (#001E2B) vanishes on the dark
 * canvas, so this delegates to the dark/light pair (green leaf in dark).
 * Prefer importing `MongodbDark` / `MongodbLight` directly when the caller
 * already knows the resolved theme (e.g. the `DatabaseLogo` brand resolver).
 */
export const Mongodb = (props: SVGProps<SVGSVGElement>) => {
  const { resolvedTheme, theme } = useTheme();
  const isDark = (resolvedTheme ?? theme) === "dark";
  return isDark ? <MongodbDark {...props} /> : <MongodbLight {...props} />;
};
