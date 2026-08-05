// Publishing templates — the MariaDB-backed classics. See ./types.ts for the
// honesty contract.
import type { StackTemplate } from "./types";

export const PUBLISHING_TEMPLATES: StackTemplate[] = [
  {
    id: "wordpress",
    name: "WordPress",
    description:
      "The most-deployed CMS there is — themes, plugins and a familiar admin. Bundled MariaDB; the whole site directory persists to a named volume so plugins survive redeploys.",
    category: "cms",
    includes: ["wordpress", "db"],
    requiredEnv: [
      {
        key: "MYSQL_PASSWORD",
        description: "Password for the bundled MariaDB user WordPress connects as.",
      },
      {
        key: "MYSQL_ROOT_PASSWORD",
        description: "Root password for the bundled MariaDB.",
      },
    ],
    logoBrand: "WordPress",
    docsUrl: "https://hub.docker.com/_/wordpress",
    compose: `name: wordpress
services:
  wordpress:
    image: wordpress:6-apache
    depends_on:
      - db
    environment:
      WORDPRESS_DB_HOST: "db:3306"
      WORDPRESS_DB_USER: wordpress
      WORDPRESS_DB_PASSWORD: \${MYSQL_PASSWORD}
      WORDPRESS_DB_NAME: wordpress
    ports:
      - "80"
    volumes:
      - wordpress-html:/var/www/html
    restart: always
  db:
    image: mariadb:11
    environment:
      MARIADB_DATABASE: wordpress
      MARIADB_USER: wordpress
      MARIADB_PASSWORD: \${MYSQL_PASSWORD}
      MARIADB_ROOT_PASSWORD: \${MYSQL_ROOT_PASSWORD}
    volumes:
      - wordpress-db:/var/lib/mysql
    restart: always
volumes:
  wordpress-html:
  wordpress-db:
`,
  },
  {
    id: "matomo",
    name: "Matomo",
    description:
      "Full-featured web analytics you host yourself — sessions, funnels, goals and heatmaps, with raw data that never leaves your server. Heavier than Plausible, and far more detailed.",
    category: "analytics",
    includes: ["matomo", "db"],
    requiredEnv: [
      {
        key: "MYSQL_PASSWORD",
        description: "Password for the bundled MariaDB user Matomo connects as.",
      },
      {
        key: "MYSQL_ROOT_PASSWORD",
        description: "Root password for the bundled MariaDB.",
      },
    ],
    logoBrand: "Matomo",
    docsUrl: "https://hub.docker.com/_/matomo",
    compose: `name: matomo
services:
  matomo:
    image: matomo:5-apache
    depends_on:
      - db
    environment:
      MATOMO_DATABASE_HOST: db
      MATOMO_DATABASE_ADAPTER: mysql
      MATOMO_DATABASE_USERNAME: matomo
      MATOMO_DATABASE_PASSWORD: \${MYSQL_PASSWORD}
      MATOMO_DATABASE_DBNAME: matomo
    ports:
      - "80"
    volumes:
      - matomo-html:/var/www/html
    restart: always
  db:
    image: mariadb:11
    environment:
      MARIADB_DATABASE: matomo
      MARIADB_USER: matomo
      MARIADB_PASSWORD: \${MYSQL_PASSWORD}
      MARIADB_ROOT_PASSWORD: \${MYSQL_ROOT_PASSWORD}
    volumes:
      - matomo-db:/var/lib/mysql
    restart: always
volumes:
  matomo-html:
  matomo-db:
`,
  },
];
