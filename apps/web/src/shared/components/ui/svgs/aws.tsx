import type { SVGProps } from "react";

import { useTheme } from "@/shared/components/theme-provider";

import { AwsDark } from "./aws-dark";
import { AwsLight } from "./aws-light";

/**
 * Theme-aware AWS lockup — the navy "aws" text vanishes on the dark canvas,
 * so this delegates to the dark/light pair. Prefer importing `AwsDark` /
 * `AwsLight` directly when the caller already knows the resolved theme
 * (e.g. the `SvglLogo` brand resolver).
 */
export const Aws = (props: SVGProps<SVGSVGElement>) => {
  const { resolvedTheme, theme } = useTheme();
  const isDark = (resolvedTheme ?? theme) === "dark";
  return isDark ? <AwsDark {...props} /> : <AwsLight {...props} />;
};
