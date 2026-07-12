import { type CSSProperties, createElement, type ReactNode, type SVGProps } from "react";

import { useTheme } from "@/shared/components/theme-provider";
import { AwsDark } from "@/shared/components/ui/svgs/aws-dark";
import { AwsLight } from "@/shared/components/ui/svgs/aws-light";
import { Azure } from "@/shared/components/ui/svgs/azure";
import { Bitbucket } from "@/shared/components/ui/svgs/bitbucket";
import { Directus } from "@/shared/components/ui/svgs/directus";
import { Discord } from "@/shared/components/ui/svgs/discord";
import { Docker } from "@/shared/components/ui/svgs/docker";
import { Excalidraw } from "@/shared/components/ui/svgs/excalidraw";
import { Firebase } from "@/shared/components/ui/svgs/firebase";
import { Ghost } from "@/shared/components/ui/svgs/ghost";
import { Gitea } from "@/shared/components/ui/svgs/gitea";
import { Github } from "@/shared/components/ui/svgs/github";
import { Gitlab } from "@/shared/components/ui/svgs/gitlab";
import { GoogleCloud } from "@/shared/components/ui/svgs/google-cloud";
import { Grafana } from "@/shared/components/ui/svgs/grafana";
import { Harbor } from "@/shared/components/ui/svgs/harbor";
import { Metabase } from "@/shared/components/ui/svgs/metabase";
import { Minio } from "@/shared/components/ui/svgs/minio";
import { N8n } from "@/shared/components/ui/svgs/n8n";
import { Nocodb } from "@/shared/components/ui/svgs/nocodb";
import { Pagerduty } from "@/shared/components/ui/svgs/pagerduty";
import { Plausible } from "@/shared/components/ui/svgs/plausible";
import { Slack } from "@/shared/components/ui/svgs/slack";
import { Telegram } from "@/shared/components/ui/svgs/telegram";
import { Umami } from "@/shared/components/ui/svgs/umami";
import { UptimeKuma } from "@/shared/components/ui/svgs/uptime-kuma";
import { Vaultwarden } from "@/shared/components/ui/svgs/vaultwarden";

type BrandKey =
  | "GitHub"
  | "GitLab"
  | "Gitea"
  | "Bitbucket"
  | "Docker"
  | "Harbor"
  | "Slack"
  | "Discord"
  | "Telegram"
  | "PagerDuty"
  | "Firebase"
  | "Google Cloud"
  | "AWS"
  | "Azure"
  // Stack-template service brands (see features/templates catalog `logoBrand`).
  | "Ghost"
  | "Directus"
  | "Plausible"
  | "Umami"
  | "Metabase"
  | "MinIO"
  | "NocoDB"
  | "n8n"
  | "Uptime Kuma"
  | "Grafana"
  | "Vaultwarden"
  | "Excalidraw";

interface Props {
  search: string;
  size?: number;
  alt?: string;
  fallback?: string;
  background?: string;
  color?: string;
  border?: string;
  style?: CSSProperties;
}

type SvgComponent = (props: SVGProps<SVGSVGElement>) => ReactNode;

/**
 * Multi-color marks whose ink parts flip between themes (AWS's navy "aws"
 * text is invisible on the dark canvas). Selected via the app theme hook —
 * `resolvedTheme` also tracks the OS when theme="system".
 */
const themedBrands: Record<
  Extract<BrandKey, "AWS">,
  { dark: SvgComponent; light: SvgComponent }
> = {
  AWS: { dark: AwsDark, light: AwsLight },
};

/**
 * Theme-stable marks: either colorful in any theme, or monochrome via
 * `currentColor` (GitHub) so they inherit the tile's `color`.
 */
const staticBrands: Record<Exclude<BrandKey, "AWS">, SvgComponent> = {
  GitHub: Github,
  GitLab: Gitlab,
  Gitea,
  Bitbucket,
  Docker,
  Harbor,
  Slack,
  Discord,
  Telegram,
  PagerDuty: Pagerduty,
  Firebase,
  "Google Cloud": GoogleCloud,
  Azure,
  Ghost,
  Directus,
  Plausible,
  Umami,
  Metabase,
  MinIO: Minio,
  NocoDB: Nocodb,
  n8n: N8n,
  "Uptime Kuma": UptimeKuma,
  Grafana,
  Vaultwarden,
  Excalidraw,
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
  // Module-level map lookup — the returned component identity is stable, so
  // rendering it via `createElement` (not a render-local <Capitalized />) keeps
  // React from treating it as a component created during render.
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
        createElement(icon, {
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
  if (search in themedBrands) {
    const pair = themedBrands[search as keyof typeof themedBrands];
    return isDark ? pair.dark : pair.light;
  }
  if (search in staticBrands) {
    return staticBrands[search as keyof typeof staticBrands];
  }
  return null;
}
