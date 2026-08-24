import { type CSSProperties, createElement, type ReactNode, type SVGProps } from "react";

import { useTheme } from "@/shared/components/theme-provider";
import { Activepieces } from "@/shared/components/ui/svgs/activepieces";
import { Anythingllm } from "@/shared/components/ui/svgs/anythingllm";
import { Appsmith } from "@/shared/components/ui/svgs/appsmith";
import { Authentik } from "@/shared/components/ui/svgs/authentik";
import { Autumn } from "@/shared/components/ui/svgs/autumn";
import { AwsDark } from "@/shared/components/ui/svgs/aws-dark";
import { AwsLight } from "@/shared/components/ui/svgs/aws-light";
import { Azure } from "@/shared/components/ui/svgs/azure";
import { Baserow } from "@/shared/components/ui/svgs/baserow";
import { Beszel } from "@/shared/components/ui/svgs/beszel";
import { Bitbucket } from "@/shared/components/ui/svgs/bitbucket";
import { BookStack } from "@/shared/components/ui/svgs/bookstack";
import { Budibase } from "@/shared/components/ui/svgs/budibase";
import { CalCom } from "@/shared/components/ui/svgs/cal-com";
import { Chatwoot } from "@/shared/components/ui/svgs/chatwoot";
import { Chromium } from "@/shared/components/ui/svgs/chromium";
import { ClickHouse } from "@/shared/components/ui/svgs/clickhouse";
import { Dbeaver } from "@/shared/components/ui/svgs/dbeaver";
import { Directus } from "@/shared/components/ui/svgs/directus";
import { Discord } from "@/shared/components/ui/svgs/discord";
import { Docker } from "@/shared/components/ui/svgs/docker";
import { Docmost } from "@/shared/components/ui/svgs/docmost";
import { Drizzle } from "@/shared/components/ui/svgs/drizzle";
import { EclipseMosquitto } from "@/shared/components/ui/svgs/eclipse-mosquitto";
import { Excalidraw } from "@/shared/components/ui/svgs/excalidraw";
import { Firebase } from "@/shared/components/ui/svgs/firebase";
import { Flowise } from "@/shared/components/ui/svgs/flowise";
import { Forgejo } from "@/shared/components/ui/svgs/forgejo";
import { Ghost } from "@/shared/components/ui/svgs/ghost";
import { Gitea } from "@/shared/components/ui/svgs/gitea";
import { Github } from "@/shared/components/ui/svgs/github";
import { Gitlab } from "@/shared/components/ui/svgs/gitlab";
import { Glitchtip } from "@/shared/components/ui/svgs/glitchtip";
import { GoogleCloud } from "@/shared/components/ui/svgs/google-cloud";
import { Gotenberg } from "@/shared/components/ui/svgs/gotenberg";
import { Grafana } from "@/shared/components/ui/svgs/grafana";
import { Grist } from "@/shared/components/ui/svgs/grist";
import { Harbor } from "@/shared/components/ui/svgs/harbor";
import { Hasura } from "@/shared/components/ui/svgs/hasura";
import { Healthchecks } from "@/shared/components/ui/svgs/healthchecks";
import { HomeAssistant } from "@/shared/components/ui/svgs/home-assistant";
import { Hoppscotch } from "@/shared/components/ui/svgs/hoppscotch";
import { Immich } from "@/shared/components/ui/svgs/immich";
import { Infisical } from "@/shared/components/ui/svgs/infisical";
import { ItTools } from "@/shared/components/ui/svgs/it-tools";
import { Jaeger } from "@/shared/components/ui/svgs/jaeger";
import { Jellyfin } from "@/shared/components/ui/svgs/jellyfin";
import { JitsiMeet } from "@/shared/components/ui/svgs/jitsi-meet";
import { Karakeep } from "@/shared/components/ui/svgs/karakeep";
import { Kestra } from "@/shared/components/ui/svgs/kestra";
import { Keycloak } from "@/shared/components/ui/svgs/keycloak";
import { LibreChat } from "@/shared/components/ui/svgs/librechat";
import { Libretranslate } from "@/shared/components/ui/svgs/libretranslate";
import { Listmonk } from "@/shared/components/ui/svgs/listmonk";
import { Litellm } from "@/shared/components/ui/svgs/litellm";
import { LiveKit } from "@/shared/components/ui/svgs/livekit";
import { Mailpit } from "@/shared/components/ui/svgs/mailpit";
import { Matomo } from "@/shared/components/ui/svgs/matomo";
import { Mattermost } from "@/shared/components/ui/svgs/mattermost";
import { Mautic } from "@/shared/components/ui/svgs/mautic";
import { Meilisearch } from "@/shared/components/ui/svgs/meilisearch";
import { Memos } from "@/shared/components/ui/svgs/memos";
import { Metabase } from "@/shared/components/ui/svgs/metabase";
import { Minio } from "@/shared/components/ui/svgs/minio";
import { N8n } from "@/shared/components/ui/svgs/n8n";
import { Nats } from "@/shared/components/ui/svgs/nats";
import { NetBird } from "@/shared/components/ui/svgs/netbird";
import { Nextcloud } from "@/shared/components/ui/svgs/nextcloud";
import { NocoBase } from "@/shared/components/ui/svgs/nocobase";
import { Nocodb } from "@/shared/components/ui/svgs/nocodb";
import { Ntfy } from "@/shared/components/ui/svgs/ntfy";
import { Odoo } from "@/shared/components/ui/svgs/odoo";
import { Ollama } from "@/shared/components/ui/svgs/ollama";
import { Outline } from "@/shared/components/ui/svgs/outline";
import { Pagerduty } from "@/shared/components/ui/svgs/pagerduty";
import { PaperlessNgx } from "@/shared/components/ui/svgs/paperless-ngx";
import { Penpot } from "@/shared/components/ui/svgs/penpot";
import { Plausible } from "@/shared/components/ui/svgs/plausible";
import { PocketId } from "@/shared/components/ui/svgs/pocket-id";
import { Pocketbase } from "@/shared/components/ui/svgs/pocketbase";
import { PrestaShop } from "@/shared/components/ui/svgs/prestashop";
import { Qdrant } from "@/shared/components/ui/svgs/qdrant";
import { Rabbitmq } from "@/shared/components/ui/svgs/rabbitmq";
import { Rustfs } from "@/shared/components/ui/svgs/rustfs";
import { Slack } from "@/shared/components/ui/svgs/slack";
import { Soketi } from "@/shared/components/ui/svgs/soketi";
import { StirlingPdf } from "@/shared/components/ui/svgs/stirling-pdf";
import { Telegram } from "@/shared/components/ui/svgs/telegram";
import { Temporal } from "@/shared/components/ui/svgs/temporal";
import { ToolJet } from "@/shared/components/ui/svgs/tooljet";
import { Twenty } from "@/shared/components/ui/svgs/twenty";
import { Typesense } from "@/shared/components/ui/svgs/typesense";
import { Umami } from "@/shared/components/ui/svgs/umami";
import { Unleash } from "@/shared/components/ui/svgs/unleash";
import { UptimeKuma } from "@/shared/components/ui/svgs/uptime-kuma";
import { Valkey } from "@/shared/components/ui/svgs/valkey";
import { Vaultwarden } from "@/shared/components/ui/svgs/vaultwarden";
import { Verdaccio } from "@/shared/components/ui/svgs/verdaccio";
import { Vikunja } from "@/shared/components/ui/svgs/vikunja";
import { VisualStudioCode } from "@/shared/components/ui/svgs/vscode";
import { WikiJs } from "@/shared/components/ui/svgs/wikijs";
import { Windmill } from "@/shared/components/ui/svgs/windmill";
import { Wordpress } from "@/shared/components/ui/svgs/wordpress";

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
  | "NetBird"
  | "NocoDB"
  | "n8n"
  | "Uptime Kuma"
  | "Grafana"
  | "Vaultwarden"
  | "Excalidraw"
  | "Authentik"
  | "Twenty"
  // Second wave of stack-template brands (Simple Icons marks).
  | "Baserow"
  | "DBeaver"
  | "Drizzle"
  | "Eclipse Mosquitto"
  | "Forgejo"
  | "Hasura"
  | "Hoppscotch"
  | "Jaeger"
  | "Keycloak"
  | "LibreTranslate"
  | "Listmonk"
  | "Matomo"
  | "Meilisearch"
  | "NATS"
  | "Ollama"
  | "PocketBase"
  | "RabbitMQ"
  | "RustFS"
  | "Temporal"
  | "Verdaccio"
  | "WordPress"
  | "ntfy"
  // Third wave: the self-hosted marks neither SVGL nor Simple Icons
  // carries, sourced from dashboard-icons, selfhst/icons, and each
  // project's own site (see the component files).
  | "Activepieces"
  | "AnythingLLM"
  | "Autumn"
  | "Beszel"
  | "Chromium"
  | "Docmost"
  | "Flowise"
  | "GlitchTip"
  | "Gotenberg"
  | "Healthchecks"
  | "IT Tools"
  | "Infisical"
  | "LiteLLM"
  | "Mailpit"
  | "Pocket ID"
  | "Soketi"
  | "Unleash"
  | "Visual Studio Code"
  // Fourth wave: the chat, project, media, commerce, low-code and design
  // brands behind the categories the catalog opened (see catalog/types.ts).
  | "Appsmith"
  | "BookStack"
  | "Budibase"
  | "Cal.com"
  | "Chatwoot"
  | "Grist"
  | "ClickHouse"
  | "Home Assistant"
  | "Immich"
  | "Jellyfin"
  | "Jitsi Meet"
  | "Karakeep"
  | "Kestra"
  | "LibreChat"
  | "LiveKit"
  | "Mattermost"
  | "Mautic"
  | "Memos"
  | "Nextcloud"
  | "NocoBase"
  | "Odoo"
  | "Outline"
  | "Paperless-ngx"
  | "Penpot"
  | "PrestaShop"
  | "Qdrant"
  | "Stirling PDF"
  | "ToolJet"
  | "Typesense"
  | "Valkey"
  | "Vikunja"
  | "Wiki.js"
  | "Windmill";

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
 * text is invisible on the dark canvas). Selected via the app theme hook.
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
  Baserow: Baserow,
  DBeaver: Dbeaver,
  Drizzle: Drizzle,
  "Eclipse Mosquitto": EclipseMosquitto,
  Forgejo: Forgejo,
  Hasura: Hasura,
  Hoppscotch: Hoppscotch,
  Jaeger: Jaeger,
  Keycloak: Keycloak,
  LibreTranslate: Libretranslate,
  Listmonk: Listmonk,
  Matomo: Matomo,
  Meilisearch: Meilisearch,
  NATS: Nats,
  Ollama: Ollama,
  PocketBase: Pocketbase,
  RabbitMQ: Rabbitmq,
  RustFS: Rustfs,
  Temporal: Temporal,
  Verdaccio: Verdaccio,
  WordPress: Wordpress,
  ntfy: Ntfy,
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
  NetBird: NetBird,
  NocoDB: Nocodb,
  n8n: N8n,
  "Uptime Kuma": UptimeKuma,
  Grafana,
  Vaultwarden,
  Excalidraw,
  Authentik,
  Twenty,
  Activepieces,
  AnythingLLM: Anythingllm,
  Autumn,
  Beszel,
  Chromium,
  Docmost,
  Flowise,
  GlitchTip: Glitchtip,
  Gotenberg,
  Healthchecks,
  "IT Tools": ItTools,
  Infisical,
  LiteLLM: Litellm,
  Mailpit,
  "Pocket ID": PocketId,
  Soketi,
  Unleash,
  "Visual Studio Code": VisualStudioCode,
  Appsmith: Appsmith,
  BookStack: BookStack,
  Budibase: Budibase,
  "Cal.com": CalCom,
  Chatwoot: Chatwoot,
  Grist: Grist,
  ClickHouse: ClickHouse,
  "Home Assistant": HomeAssistant,
  Immich: Immich,
  Jellyfin: Jellyfin,
  "Jitsi Meet": JitsiMeet,
  Karakeep: Karakeep,
  Kestra: Kestra,
  LibreChat: LibreChat,
  LiveKit: LiveKit,
  Mattermost: Mattermost,
  Mautic: Mautic,
  Memos: Memos,
  Nextcloud: Nextcloud,
  NocoBase: NocoBase,
  Odoo: Odoo,
  Outline: Outline,
  "Paperless-ngx": PaperlessNgx,
  Penpot: Penpot,
  PrestaShop: PrestaShop,
  Qdrant: Qdrant,
  "Stirling PDF": StirlingPdf,
  ToolJet: ToolJet,
  Typesense: Typesense,
  Valkey: Valkey,
  Vikunja: Vikunja,
  "Wiki.js": WikiJs,
  Windmill: Windmill,
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
  // Module-level map lookup. The returned component identity is stable, so
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

/**
 * Whether a `logoBrand` resolves to a real mark rather than the letter tile.
 *
 * Exported for the catalog's coverage test: a template whose brand isn't
 * registered here still renders, as a grey initial, so nothing fails and
 * nobody notices until the gallery is full of `A`s and `B`s. The test turns
 * that into a build failure the moment a template lands without its logo.
 */
export function hasBrandMark(search: string): boolean {
  return search in themedBrands || search in staticBrands;
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
