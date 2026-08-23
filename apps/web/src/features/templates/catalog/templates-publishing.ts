// Publishing templates: the MariaDB-backed classics. See ./types.ts for the
// honesty contract.
import type { StackTemplate } from "./types";

export const PUBLISHING_TEMPLATES: StackTemplate[] = [
  {
    id: "wordpress",
    name: "WordPress",
    descriptionKey: "templates.catalog.wordpress.description",
    category: "cms",
    includes: ["wordpress", "db"],
    requiredEnv: [
      {
        key: "MYSQL_PASSWORD",
        descriptionKey: "templates.catalog.wordpress.env.MYSQL_PASSWORD",
      },
      {
        key: "MYSQL_ROOT_PASSWORD",
        descriptionKey: "templates.catalog.wordpress.env.MYSQL_ROOT_PASSWORD",
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
      WORDPRESS_DB_HOST: "\${{stack.db.HOST}}:3306"
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
    descriptionKey: "templates.catalog.matomo.description",
    category: "analytics",
    includes: ["matomo", "db"],
    requiredEnv: [
      {
        key: "MYSQL_PASSWORD",
        descriptionKey: "templates.catalog.matomo.env.MYSQL_PASSWORD",
      },
      {
        key: "MYSQL_ROOT_PASSWORD",
        descriptionKey: "templates.catalog.matomo.env.MYSQL_ROOT_PASSWORD",
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
      MATOMO_DATABASE_HOST: "\${{stack.db.HOST}}"
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
