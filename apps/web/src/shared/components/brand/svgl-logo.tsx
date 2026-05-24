import type { CSSProperties, ReactNode, SVGProps } from "react";
import { useTheme } from "next-themes";
import { AwsDark } from "@/shared/components/ui/svgs/awsDark";
import { AwsLight } from "@/shared/components/ui/svgs/awsLight";
import { Azure } from "@/shared/components/ui/svgs/azure";
import { Discord } from "@/shared/components/ui/svgs/discord";
import { Docker } from "@/shared/components/ui/svgs/docker";
import { GithubDark } from "@/shared/components/ui/svgs/githubDark";
import { GithubLight } from "@/shared/components/ui/svgs/githubLight";
import { Gitlab } from "@/shared/components/ui/svgs/gitlab";
import { GoogleCloud } from "@/shared/components/ui/svgs/googleCloud";
import { Slack } from "@/shared/components/ui/svgs/slack";
import { Telegram } from "@/shared/components/ui/svgs/telegram";

type BrandKey =
  | "GitHub"
  | "GitLab"
  | "Docker"
  | "Slack"
  | "Discord"
  | "Telegram"
  | "Google Cloud"
  | "AWS"
  | "Azure";

type Props = {
  search: string;
  size?: number;
  alt?: string;
  fallback?: string;
  background?: string;
  color?: string;
  border?: string;
  style?: CSSProperties;
};

type SvgComponent = (props: SVGProps<SVGSVGElement>) => ReactNode;

const themedBrands: Record<
  Extract<BrandKey, "GitHub" | "AWS">,
  { dark: SvgComponent; light: SvgComponent }
> = {
  GitHub: { dark: GithubDark, light: GithubLight },
  AWS: { dark: AwsDark, light: AwsLight },
};

const staticBrands: Record<
  Exclude<BrandKey, "GitHub" | "AWS">,
  SvgComponent
> = {
  GitLab: Gitlab,
  Docker,
  Slack,
  Discord,
  Telegram,
  "Google Cloud": GoogleCloud,
  Azure,
};

export function SvglLogo({
  search,
  size = 28,
  alt = "",
  fallback,
  background = "var(--muted)",
  color = "var(--foreground)",
  border = "1px solid var(--border)",
  style,
}: Props) {
  const { resolvedTheme, theme } = useTheme();
  const isDark = (resolvedTheme ?? theme) === "dark";
  const icon = resolveBrand(search, isDark);

  return (
    <span
      aria-hidden={alt === "" ? true : undefined}
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        display: "inline-grid",
        placeItems: "center",
        overflow: "hidden",
        flexShrink: 0,
        background,
        color,
        border,
        ...style,
      }}
    >
      {icon ? (
        icon({
          width: Math.round(size * 0.68),
          height: Math.round(size * 0.68),
          "aria-hidden": alt === "" ? true : undefined,
          role: alt === "" ? "presentation" : "img",
        })
      ) : (
        <span
          className="font-mono"
          style={{
            fontWeight: 700,
            fontSize: Math.round(size * 0.42),
            letterSpacing: "-0.02em",
            color,
          }}
        >
          {(fallback ?? search).slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}

function resolveBrand(search: string, isDark: boolean): SvgComponent | null {
  if (search === "GitHub" || search === "AWS") {
    return isDark ? themedBrands[search].dark : themedBrands[search].light;
  }
  if (search in staticBrands) {
    return staticBrands[search as keyof typeof staticBrands];
  }
  return null;
}
