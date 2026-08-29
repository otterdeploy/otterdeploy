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
import beszel from "./beszel.env.schema?raw";
import docker_registry from "./docker-registry.env.schema?raw";
import dozzle from "./dozzle.env.schema?raw";
import excalidraw from "./excalidraw.env.schema?raw";
import gotenberg from "./gotenberg.env.schema?raw";
import it_tools from "./it-tools.env.schema?raw";
import minio from "./minio.env.schema?raw";
import mosquitto from "./mosquitto.env.schema?raw";
import nats from "./nats.env.schema?raw";
import postiz from "./postiz.env.schema?raw";
import qdrant from "./qdrant.env.schema?raw";
import typesense from "./typesense.env.schema?raw";
import uptime_kuma from "./uptime-kuma.env.schema?raw";

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
export const ENV_SCHEMAS: Record<string, TemplateEnvSchema> = {
  beszel: { source: beszel, images: ["henrygd/beszel"] },
  "docker-registry": { source: docker_registry, images: ["registry"] },
  dozzle: { source: dozzle, images: ["amir20/dozzle"] },
  excalidraw: { source: excalidraw, images: ["excalidraw/excalidraw"] },
  gotenberg: { source: gotenberg, images: ["gotenberg/gotenberg"] },
  "it-tools": { source: it_tools, images: ["corentinth/it-tools"] },
  minio: { source: minio, images: ["minio/minio"] },
  mosquitto: { source: mosquitto, images: ["eclipse-mosquitto"] },
  nats: { source: nats, images: ["nats"] },
  qdrant: { source: qdrant, images: ["qdrant/qdrant"] },
  typesense: { source: typesense, images: ["typesense/typesense"] },
  "uptime-kuma": { source: uptime_kuma, images: ["louislam/uptime-kuma"] },
  postiz: { source: postiz, images: ["ghcr.io/gitroomhq/postiz-app"] },
};
