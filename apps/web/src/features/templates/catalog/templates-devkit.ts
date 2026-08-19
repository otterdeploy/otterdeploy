// Developer-infrastructure templates: registries, API tooling, a browser IDE.
// See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const DEVKIT_TEMPLATES: StackTemplate[] = [
  {
    id: "dozzle",
    name: "Dozzle",
    description:
      "Live log viewer for every container on the host. Tail, search and follow without SSH. Reads the Docker socket, so anyone who reaches it can read every container's logs: keep it behind Require login in the service's Deployment protection.",
    category: "devtools",
    includes: ["dozzle"],
    requiredEnv: [],
    logoBrand: "Docker",
    docsUrl: "https://dozzle.dev/guide/getting-started",
    compose: `name: dozzle
services:
  dozzle:
    image: amir20/dozzle:latest
    environment:
      DOZZLE_LEVEL: info
      DOZZLE_NO_ANALYTICS: "true"
    ports:
      - "8080"
    volumes:
      # Read-only, and read-only matters: the socket is root-equivalent on the
      # host, so :ro is the difference between "can read logs" and "can start a
      # privileged container". Dozzle only ever reads.
      - /var/run/docker.sock:/var/run/docker.sock:ro
    restart: always
`,
  },
  {
    id: "verdaccio",
    name: "Verdaccio",
    description:
      "Private npm registry that proxies and caches the public one. Publish internal packages without paying for a private scope, and keep installing when npmjs is down.",
    category: "devtools",
    includes: ["verdaccio"],
    requiredEnv: [],
    logoBrand: "Verdaccio",
    docsUrl: "https://verdaccio.org/docs/docker",
    compose: `name: verdaccio
services:
  verdaccio:
    image: verdaccio/verdaccio:6
    ports:
      - "4873"
    volumes:
      - verdaccio-storage:/verdaccio/storage
      - verdaccio-config:/verdaccio/conf
    restart: always
volumes:
  verdaccio-storage:
  verdaccio-config:
`,
  },
  {
    id: "docker-registry",
    name: "Docker Registry",
    description:
      "The reference OCI registry: a private place to push images your services then pull. Pairs with a service's image target so builds never leave your own infrastructure.",
    category: "devtools",
    includes: ["registry"],
    requiredEnv: [],
    logoBrand: "Docker",
    docsUrl: "https://distribution.github.io/distribution/about/deploying/",
    compose: `name: docker-registry
services:
  registry:
    image: registry:3
    environment:
      REGISTRY_STORAGE_DELETE_ENABLED: "true"
    ports:
      - "5000"
    volumes:
      - registry-data:/var/lib/registry
    restart: always
volumes:
  registry-data:
`,
  },
  {
    id: "hoppscotch",
    name: "Hoppscotch",
    description:
      "API client in the browser: REST, GraphQL and WebSocket requests with collections and environments. A self-hosted alternative to Postman that never syncs your tokens anywhere.",
    category: "devtools",
    includes: ["hoppscotch"],
    requiredEnv: [],
    logoBrand: "Hoppscotch",
    docsUrl:
      "https://docs.hoppscotch.io/documentation/self-host/community-edition/install-and-build",
    compose: `name: hoppscotch
services:
  hoppscotch:
    image: hoppscotch/hoppscotch:latest
    ports:
      - "3000"
    restart: always
`,
  },
  {
    id: "code-server",
    name: "code-server",
    description:
      "VS Code running on the server, reached from a browser tab. The editor keeps its extensions and terminal on the machine, so a laptop or tablet is only a screen.",
    category: "devtools",
    includes: ["code-server"],
    requiredEnv: [
      {
        key: "CODE_SERVER_PASSWORD",
        description: "Password for the web UI. Anyone with it gets a shell on this container.",
      },
    ],
    logoBrand: "Visual Studio Code",
    docsUrl: "https://coder.com/docs/code-server/install#docker",
    compose: `name: code-server
services:
  code-server:
    image: codercom/code-server:latest
    environment:
      PASSWORD: \${CODE_SERVER_PASSWORD}
    command:
      - --bind-addr
      - 0.0.0.0:8080
      - /home/coder/project
    ports:
      - "8080"
    volumes:
      - code-server-config:/home/coder/.config
      - code-server-project:/home/coder/project
    restart: always
volumes:
  code-server-config:
  code-server-project:
`,
  },
  {
    id: "jaeger",
    name: "Jaeger",
    description:
      "Distributed tracing. Send OpenTelemetry spans and follow one request across every service it touched. All-in-one image with in-memory storage, so it starts with no dependencies.",
    category: "observability",
    includes: ["jaeger"],
    requiredEnv: [],
    logoBrand: "Jaeger",
    docsUrl: "https://www.jaegertracing.io/docs/1.62/getting-started/",
    compose: `name: jaeger
services:
  jaeger:
    image: jaegertracing/all-in-one:1.76.0
    environment:
      COLLECTOR_OTLP_ENABLED: "true"
      SPAN_STORAGE_TYPE: memory
    ports:
      - "16686"
      - "4317"
      - "4318"
    restart: always
`,
  },
  {
    id: "healthchecks",
    name: "Healthchecks",
    description:
      "Dead-man's-switch monitoring for cron jobs and backups. Each job pings a URL when it finishes, and you get alerted when a ping does not arrive on schedule.",
    category: "observability",
    includes: ["healthchecks", "db"],
    requiredEnv: [
      {
        key: "SITE_ROOT",
        description: "Public base URL. Appears in ping URLs and alert emails.",
      },
      {
        key: "SECRET_KEY",
        description: "Django secret. Signs sessions and tokens.",
      },
      {
        key: "POSTGRES_PASSWORD",
        description: "Password for the bundled Postgres.",
      },
    ],
    logoBrand: "Healthchecks",
    docsUrl: "https://healthchecks.io/docs/self_hosted_docker/",
    compose: `name: healthchecks
services:
  healthchecks:
    image: healthchecks/healthchecks:v3.10
    depends_on:
      - db
    environment:
      SITE_ROOT: \${SITE_ROOT}
      SECRET_KEY: \${SECRET_KEY}
      DB: postgres
      DB_HOST: "\${{stack.db.HOST}}"
      DB_PORT: "5432"
      DB_NAME: healthchecks
      DB_USER: healthchecks
      DB_PASSWORD: \${POSTGRES_PASSWORD}
      ALLOWED_HOSTS: "*"
      DEBUG: "False"
    ports:
      - "8000"
    restart: always
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: healthchecks
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: healthchecks
    volumes:
      - healthchecks-db:/var/lib/postgresql/data
    restart: always
volumes:
  healthchecks-db:
`,
  },
];
