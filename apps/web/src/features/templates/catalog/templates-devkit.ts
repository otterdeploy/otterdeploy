// Developer-infrastructure templates: registries, API tooling, a browser IDE.
// See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const DEVKIT_TEMPLATES: StackTemplate[] = [
  {
    id: "dozzle",
    name: "Dozzle",
    descriptionKey: "templates.catalog.dozzle.description",
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
    descriptionKey: "templates.catalog.verdaccio.description",
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
    descriptionKey: "templates.catalog.docker-registry.description",
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
    descriptionKey: "templates.catalog.hoppscotch.description",
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
    descriptionKey: "templates.catalog.code-server.description",
    category: "devtools",
    includes: ["code-server"],
    requiredEnv: [
      {
        key: "CODE_SERVER_PASSWORD",
        descriptionKey: "templates.catalog.code-server.env.CODE_SERVER_PASSWORD",
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
    descriptionKey: "templates.catalog.jaeger.description",
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
    descriptionKey: "templates.catalog.healthchecks.description",
    category: "observability",
    includes: ["healthchecks", "db"],
    requiredEnv: [
      {
        key: "SITE_ROOT",
        descriptionKey: "templates.catalog.healthchecks.env.SITE_ROOT",
      },
      {
        key: "SECRET_KEY",
        descriptionKey: "templates.catalog.healthchecks.env.SECRET_KEY",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.healthchecks.env.POSTGRES_PASSWORD",
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
