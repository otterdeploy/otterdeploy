/**
 * Per-template environment schemas, in `@env-spec` format (the `.env.schema`
 * standard varlock reads).
 *
 * Why a standard format rather than a field on `StackTemplate`: the schema is
 * the artifact upstream projects are starting to ship themselves, so anything
 * we build against it can eventually consume theirs instead of us
 * transcribing. It also means `varlock` can lint our own files.
 *
 * OWNERSHIP IS THE VALUE. There is no `@owner` decorator to keep in sync:
 *
 *   MAIN_URL=${{stack.postiz.PUBLIC_URL}}   platform-owned, derived
 *   LINKEDIN_CLIENT_ID=                     operator-owned, must be supplied
 *   API_LIMIT=30                            defaulted, operator may override
 *
 * A platform-owned var is one otterdeploy can answer for itself, and writing
 * one as a literal is the bug this whole layer exists to prevent: a literal is
 * correct once, at install, and silently wrong from the next domain rename on.
 * `env-schema.test.ts` fails the build for it.
 *
 * The two ref syntaxes coexist deliberately. Single-brace `${VAR}` is both
 * compose interpolation and env-spec's own `ref()`; double-brace `${{…}}` is
 * otterdeploy's cross-resource ref, which the env-spec parser preserves
 * verbatim as a static value rather than trying to resolve.
 *
 * `images` is how the schema reaches a RUNNING service. Template identity is
 * not persisted on a stack — only its brand mark is — but the env-catalog
 * already keys autocomplete by image repo, so listing the app image here is
 * what lights up the service's Variables tab after install. The gate checks
 * each listed repo is one the compose actually runs.
 */
import activepieces from "./activepieces.env.schema?raw";
import affine from "./affine.env.schema?raw";
import anythingllm from "./anythingllm.env.schema?raw";
import appsmith from "./appsmith.env.schema?raw";
import authentik from "./authentik.env.schema?raw";
import autumn from "./autumn.env.schema?raw";
import baserow from "./baserow.env.schema?raw";
import beszel from "./beszel.env.schema?raw";
import bookstack from "./bookstack.env.schema?raw";
import browserless from "./browserless.env.schema?raw";
import budibase from "./budibase.env.schema?raw";
import buzz from "./buzz.env.schema?raw";
import cal_com from "./cal-com.env.schema?raw";
import chatwoot from "./chatwoot.env.schema?raw";
import clickhouse from "./clickhouse.env.schema?raw";
import cloudbeaver from "./cloudbeaver.env.schema?raw";
import code_server from "./code-server.env.schema?raw";
import directus from "./directus.env.schema?raw";
import docker_registry from "./docker-registry.env.schema?raw";
import docling from "./docling.env.schema?raw";
import docmost from "./docmost.env.schema?raw";
import documenso from "./documenso.env.schema?raw";
import dozzle from "./dozzle.env.schema?raw";
import drizzle_gateway from "./drizzle-gateway.env.schema?raw";
import excalidraw from "./excalidraw.env.schema?raw";
import flowise from "./flowise.env.schema?raw";
import forgejo from "./forgejo.env.schema?raw";
import ghost from "./ghost.env.schema?raw";
import gitea from "./gitea.env.schema?raw";
import glitchtip from "./glitchtip.env.schema?raw";
import gotenberg from "./gotenberg.env.schema?raw";
import grafana_prometheus from "./grafana-prometheus.env.schema?raw";
import grist from "./grist.env.schema?raw";
import hasura from "./hasura.env.schema?raw";
import healthchecks from "./healthchecks.env.schema?raw";
import home_assistant from "./home-assistant.env.schema?raw";
import hoppscotch from "./hoppscotch.env.schema?raw";
import immich from "./immich.env.schema?raw";
import infisical from "./infisical.env.schema?raw";
import inngest from "./inngest.env.schema?raw";
import it_tools from "./it-tools.env.schema?raw";
import jaeger from "./jaeger.env.schema?raw";
import jellyfin from "./jellyfin.env.schema?raw";
import jitsi from "./jitsi.env.schema?raw";
import karakeep from "./karakeep.env.schema?raw";
import kestra from "./kestra.env.schema?raw";
import keycloak from "./keycloak.env.schema?raw";
import librechat from "./librechat.env.schema?raw";
import libretranslate from "./libretranslate.env.schema?raw";
import listmonk from "./listmonk.env.schema?raw";
import litellm from "./litellm.env.schema?raw";
import livekit from "./livekit.env.schema?raw";
import mailpit from "./mailpit.env.schema?raw";
import matomo from "./matomo.env.schema?raw";
import mattermost from "./mattermost.env.schema?raw";
import mautic from "./mautic.env.schema?raw";
import meilisearch from "./meilisearch.env.schema?raw";
import memos from "./memos.env.schema?raw";
import metabase from "./metabase.env.schema?raw";
import minio from "./minio.env.schema?raw";
import mosquitto from "./mosquitto.env.schema?raw";
import n8n from "./n8n.env.schema?raw";
import nats from "./nats.env.schema?raw";
import netbird from "./netbird.env.schema?raw";
import nextcloud from "./nextcloud.env.schema?raw";
import nocobase from "./nocobase.env.schema?raw";
import nocodb from "./nocodb.env.schema?raw";
import ntfy from "./ntfy.env.schema?raw";
import odoo from "./odoo.env.schema?raw";
import open_webui from "./open-webui.env.schema?raw";
import openstatus from "./openstatus.env.schema?raw";
import outline from "./outline.env.schema?raw";
import paperless_ngx from "./paperless-ngx.env.schema?raw";
import penpot from "./penpot.env.schema?raw";
import plausible from "./plausible.env.schema?raw";
import pocket_id from "./pocket-id.env.schema?raw";
import pocketbase from "./pocketbase.env.schema?raw";
import postiz from "./postiz.env.schema?raw";
import prestashop from "./prestashop.env.schema?raw";
import qdrant from "./qdrant.env.schema?raw";
import rabbitmq from "./rabbitmq.env.schema?raw";
import rustfs from "./rustfs.env.schema?raw";
import soketi from "./soketi.env.schema?raw";
import stirling_pdf from "./stirling-pdf.env.schema?raw";
import temporal from "./temporal.env.schema?raw";
import tooljet from "./tooljet.env.schema?raw";
import twenty from "./twenty.env.schema?raw";
import typesense from "./typesense.env.schema?raw";
import umami from "./umami.env.schema?raw";
import unleash from "./unleash.env.schema?raw";
import uptime_kuma from "./uptime-kuma.env.schema?raw";
import usesend from "./usesend.env.schema?raw";
import valkey from "./valkey.env.schema?raw";
import vaultwarden from "./vaultwarden.env.schema?raw";
import verdaccio from "./verdaccio.env.schema?raw";
import vikunja from "./vikunja.env.schema?raw";
import wikijs from "./wikijs.env.schema?raw";
import windmill from "./windmill.env.schema?raw";
import wordpress from "./wordpress.env.schema?raw";

export interface TemplateEnvSchema {
  /** The `.env.schema` text. */
  source: string;
  /** Image repos (tagless, lowercase; see `normalizeImageRepo`) whose
   *  variables this schema describes. Usually the app image alone: the
   *  bundled Postgres/Redis are covered by the database catalog. */
  images: string[];
}

/** Template id → schema. Templates absent from this map are simply not
 *  covered by the gate or the editors yet; adding one opts it in. */
/** Template id → schema. Every template in the catalog is covered; the gate
 *  (`env-schema.test.ts`) fails the build for any entry whose schema drifts
 *  from its compose, so adding a template means adding its schema too. */
export const ENV_SCHEMAS: Record<string, TemplateEnvSchema> = {
  activepieces: { source: activepieces, images: ["ghcr.io/activepieces/activepieces"] },
  affine: { source: affine, images: ["ghcr.io/toeverything/affine"] },
  anythingllm: { source: anythingllm, images: ["mintplexlabs/anythingllm"] },
  appsmith: { source: appsmith, images: ["appsmith/appsmith-ce"] },
  authentik: { source: authentik, images: ["ghcr.io/goauthentik/server"] },
  autumn: { source: autumn, images: ["ghcr.io/dr34mw0rk5/autumn"] },
  baserow: { source: baserow, images: ["baserow/baserow"] },
  beszel: { source: beszel, images: ["henrygd/beszel"] },
  bookstack: { source: bookstack, images: ["lscr.io/linuxserver/bookstack"] },
  browserless: { source: browserless, images: ["ghcr.io/browserless/chromium"] },
  budibase: { source: budibase, images: ["budibase/budibase"] },
  buzz: { source: buzz, images: ["ghcr.io/block/buzz"] },
  "cal-com": { source: cal_com, images: ["calcom/cal.com"] },
  chatwoot: { source: chatwoot, images: ["chatwoot/chatwoot"] },
  clickhouse: { source: clickhouse, images: ["clickhouse/clickhouse-server"] },
  cloudbeaver: { source: cloudbeaver, images: ["dbeaver/cloudbeaver"] },
  "code-server": { source: code_server, images: ["codercom/code-server"] },
  directus: { source: directus, images: ["directus/directus"] },
  "docker-registry": { source: docker_registry, images: ["registry"] },
  docling: { source: docling, images: ["ghcr.io/docling-project/docling-serve-cpu"] },
  docmost: { source: docmost, images: ["docmost/docmost"] },
  documenso: { source: documenso, images: ["documenso/documenso"] },
  dozzle: { source: dozzle, images: ["amir20/dozzle"] },
  "drizzle-gateway": { source: drizzle_gateway, images: ["ghcr.io/drizzle-team/gateway"] },
  excalidraw: { source: excalidraw, images: ["excalidraw/excalidraw"] },
  flowise: { source: flowise, images: ["flowiseai/flowise"] },
  forgejo: { source: forgejo, images: ["codeberg.org/forgejo/forgejo"] },
  ghost: { source: ghost, images: ["ghost"] },
  gitea: { source: gitea, images: ["gitea/gitea"] },
  glitchtip: { source: glitchtip, images: ["glitchtip/glitchtip"] },
  gotenberg: { source: gotenberg, images: ["gotenberg/gotenberg"] },
  "grafana-prometheus": {
    source: grafana_prometheus,
    images: ["grafana/grafana", "prom/prometheus"],
  },
  grist: { source: grist, images: ["gristlabs/grist"] },
  hasura: { source: hasura, images: ["hasura/graphql-engine"] },
  healthchecks: { source: healthchecks, images: ["healthchecks/healthchecks"] },
  "home-assistant": { source: home_assistant, images: ["ghcr.io/home-assistant/home-assistant"] },
  hoppscotch: { source: hoppscotch, images: ["hoppscotch/hoppscotch"] },
  immich: {
    source: immich,
    images: ["ghcr.io/immich-app/immich-server", "ghcr.io/immich-app/immich-machine-learning"],
  },
  infisical: { source: infisical, images: ["infisical/infisical"] },
  inngest: { source: inngest, images: ["inngest/inngest"] },
  "it-tools": { source: it_tools, images: ["corentinth/it-tools"] },
  jaeger: { source: jaeger, images: ["jaegertracing/all-in-one"] },
  jellyfin: { source: jellyfin, images: ["jellyfin/jellyfin"] },
  jitsi: {
    source: jitsi,
    images: [
      "ghcr.io/jitsi/web",
      "ghcr.io/jitsi/prosody",
      "ghcr.io/jitsi/jicofo",
      "ghcr.io/jitsi/jvb",
    ],
  },
  karakeep: {
    source: karakeep,
    images: ["ghcr.io/karakeep-app/karakeep", "ghcr.io/karakeep-app/karakeep-chrome"],
  },
  kestra: { source: kestra, images: ["kestra/kestra"] },
  keycloak: { source: keycloak, images: ["quay.io/keycloak/keycloak"] },
  librechat: { source: librechat, images: ["ghcr.io/danny-avila/librechat"] },
  libretranslate: { source: libretranslate, images: ["libretranslate/libretranslate"] },
  listmonk: { source: listmonk, images: ["listmonk/listmonk"] },
  litellm: { source: litellm, images: ["ghcr.io/berriai/litellm"] },
  livekit: { source: livekit, images: ["livekit/livekit-server"] },
  mailpit: { source: mailpit, images: ["axllent/mailpit"] },
  matomo: { source: matomo, images: ["matomo"] },
  mattermost: { source: mattermost, images: ["mattermost/mattermost-team-edition"] },
  mautic: { source: mautic, images: ["mautic/mautic"] },
  meilisearch: { source: meilisearch, images: ["getmeili/meilisearch"] },
  memos: { source: memos, images: ["neosmemo/memos"] },
  metabase: { source: metabase, images: ["metabase/metabase"] },
  minio: { source: minio, images: ["minio/minio"] },
  mosquitto: { source: mosquitto, images: ["eclipse-mosquitto"] },
  n8n: { source: n8n, images: ["docker.n8n.io/n8nio/n8n"] },
  nats: { source: nats, images: ["nats"] },
  netbird: { source: netbird, images: ["netbirdio/netbird-server", "netbirdio/dashboard"] },
  nextcloud: { source: nextcloud, images: ["nextcloud"] },
  nocobase: { source: nocobase, images: ["nocobase/nocobase"] },
  nocodb: { source: nocodb, images: ["nocodb/nocodb"] },
  ntfy: { source: ntfy, images: ["binwiederhier/ntfy"] },
  odoo: { source: odoo, images: ["odoo"] },
  "open-webui": { source: open_webui, images: ["ghcr.io/open-webui/open-webui"] },
  openstatus: {
    source: openstatus,
    images: [
      "ghcr.io/openstatushq/openstatus-dashboard",
      "ghcr.io/openstatushq/openstatus-status-page",
      "ghcr.io/openstatushq/openstatus-server",
      "ghcr.io/openstatushq/openstatus-workflows",
      "ghcr.io/openstatushq/openstatus-private-location",
      "ghcr.io/openstatushq/openstatus-db-migrate",
    ],
  },
  outline: { source: outline, images: ["outlinewiki/outline"] },
  "paperless-ngx": { source: paperless_ngx, images: ["ghcr.io/paperless-ngx/paperless-ngx"] },
  penpot: {
    source: penpot,
    images: ["penpotapp/frontend", "penpotapp/backend", "penpotapp/exporter"],
  },
  plausible: { source: plausible, images: ["ghcr.io/plausible/community-edition"] },
  "pocket-id": { source: pocket_id, images: ["ghcr.io/pocket-id/pocket-id"] },
  pocketbase: { source: pocketbase, images: ["ghcr.io/muchobien/pocketbase"] },
  postiz: { source: postiz, images: ["ghcr.io/gitroomhq/postiz-app"] },
  prestashop: { source: prestashop, images: ["prestashop/prestashop"] },
  qdrant: { source: qdrant, images: ["qdrant/qdrant"] },
  rabbitmq: { source: rabbitmq, images: ["rabbitmq"] },
  rustfs: { source: rustfs, images: ["rustfs/rustfs"] },
  soketi: { source: soketi, images: ["quay.io/soketi/soketi"] },
  "stirling-pdf": { source: stirling_pdf, images: ["ghcr.io/stirling-tools/stirling-pdf"] },
  temporal: { source: temporal, images: ["temporalio/auto-setup", "temporalio/ui"] },
  tooljet: { source: tooljet, images: ["tooljet/tooljet", "postgrest/postgrest"] },
  twenty: { source: twenty, images: ["twentycrm/twenty"] },
  typesense: { source: typesense, images: ["typesense/typesense"] },
  umami: { source: umami, images: ["ghcr.io/umami-software/umami"] },
  unleash: { source: unleash, images: ["unleashorg/unleash-server"] },
  "uptime-kuma": { source: uptime_kuma, images: ["louislam/uptime-kuma"] },
  usesend: { source: usesend, images: ["usesend/usesend"] },
  valkey: { source: valkey, images: ["valkey/valkey"] },
  vaultwarden: { source: vaultwarden, images: ["vaultwarden/server"] },
  verdaccio: { source: verdaccio, images: ["verdaccio/verdaccio"] },
  vikunja: { source: vikunja, images: ["vikunja/vikunja"] },
  wikijs: { source: wikijs, images: ["ghcr.io/requarks/wiki"] },
  windmill: { source: windmill, images: ["ghcr.io/windmill-labs/windmill"] },
  wordpress: { source: wordpress, images: ["wordpress"] },
};
