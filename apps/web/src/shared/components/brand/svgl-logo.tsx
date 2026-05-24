import type { CSSProperties, ReactNode, SVGProps } from "react";

import { Aws } from "@/shared/components/ui/svgs/aws";
import { Azure } from "@/shared/components/ui/svgs/azure";
import { Discord } from "@/shared/components/ui/svgs/discord";
import { Docker } from "@/shared/components/ui/svgs/docker";
import { Github } from "@/shared/components/ui/svgs/github";
import { Gitlab } from "@/shared/components/ui/svgs/gitlab";
import { GoogleCloud } from "@/shared/components/ui/svgs/google-cloud";
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

const brands: Record<BrandKey, SvgComponent> = {
  GitHub: Github,
  GitLab: Gitlab,
  Docker,
  Slack,
  Discord,
  Telegram,
  "Google Cloud": GoogleCloud,
  AWS: Aws,
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
  const Icon = (brands as Record<string, SvgComponent | undefined>)[search];

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
      {Icon ? (
        <Icon
          width={Math.round(size * 0.68)}
          height={Math.round(size * 0.68)}
          aria-hidden={alt === "" ? true : undefined}
          role={alt === "" ? "presentation" : "img"}
        />
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
