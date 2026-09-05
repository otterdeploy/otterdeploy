// Storefronts and the business suite behind them. See ./types.ts for the
// honesty contract.
import type { StackTemplate } from "./types";

export const COMMERCE_TEMPLATES: StackTemplate[] = [
  {
    id: "odoo",
    name: "Odoo",
    descriptionKey: "templates.catalog.odoo.description",
    category: "commerce",
    includes: ["odoo", "db"],
    requiredEnv: [
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.odoo.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Odoo",
    docsUrl: "https://hub.docker.com/_/odoo",
    // Odoo reads HOST/USER/PASSWORD rather than a DSN, and it creates its own
    // databases at first run — which is why the Postgres user here owns the
    // cluster rather than a single pre-made database.
    //
    // /etc/odoo is a named volume because that is where $ODOO_RC lives, and
    // odoo.conf is the ONLY place the master password (`admin_passwd`) can be
    // stored — it has no env var and no CLI flag. Odoo writes the password an
    // operator sets on first visit back into that file; without the volume it
    // sat in the image layer and reverted to the built-in default "admin" on
    // every container recreate, leaving /web/database/manager (create, drop,
    // duplicate, backup, restore) open to anyone who reached the port. Docker
    // seeds the empty volume from the image, so odoo.conf's addons_path and
    // data_dir survive the mount.
    //
    // --proxy-mode makes Odoo trust X-Forwarded-* for URL building and client
    // IPs. Safe here and only here: otterdeploy's Caddy edge always fronts the
    // service and overwrites those headers.
    compose: `name: odoo
services:
  odoo:
    image: odoo:19.0
    depends_on:
      - db
    environment:
      HOST: "\${{stack.db.HOST}}"
      USER: odoo
      PASSWORD: \${POSTGRES_PASSWORD}
    command: ["odoo", "--proxy-mode"]
    ports:
      - "8069"
    volumes:
      - odoo-config:/etc/odoo
      - odoo-data:/var/lib/odoo
      - odoo-addons:/mnt/extra-addons
    restart: always
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: odoo
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: postgres
    volumes:
      - odoo-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U odoo"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  odoo-config:
  odoo-data:
  odoo-addons:
  odoo-db:
`,
  },
  {
    id: "prestashop",
    name: "PrestaShop",
    descriptionKey: "templates.catalog.prestashop.description",
    category: "commerce",
    includes: ["prestashop", "db"],
    requiredEnv: [
      {
        key: "PRESTASHOP_DOMAIN",
        descriptionKey: "templates.catalog.prestashop.env.PRESTASHOP_DOMAIN",
      },
      { key: "ADMIN_EMAIL", descriptionKey: "templates.catalog.prestashop.env.ADMIN_EMAIL" },
      {
        key: "ADMIN_PASSWORD",
        descriptionKey: "templates.catalog.prestashop.env.ADMIN_PASSWORD",
        generateHint: "openssl rand -base64 18",
      },
      {
        key: "MYSQL_PASSWORD",
        descriptionKey: "templates.catalog.prestashop.env.MYSQL_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "PrestaShop",
    docsUrl: "https://github.com/PrestaShop/docker",
    compose: `name: prestashop
services:
  prestashop:
    image: prestashop/prestashop:9.1.5-apache
    depends_on:
      - db
    environment:
      DB_SERVER: "\${{stack.db.HOST}}"
      DB_NAME: prestashop
      DB_USER: prestashop
      DB_PASSWD: \${MYSQL_PASSWORD}
      PS_DOMAIN: \${PRESTASHOP_DOMAIN}
      PS_INSTALL_AUTO: "1"
      PS_ERASE_DB: "0"
      PS_DEV_MODE: "0"
      ADMIN_MAIL: \${ADMIN_EMAIL}
      ADMIN_PASSWD: \${ADMIN_PASSWORD}
    ports:
      - "80"
    volumes:
      - prestashop-data:/var/www/html
    restart: always
  db:
    image: mysql:8.4
    environment:
      MYSQL_DATABASE: prestashop
      MYSQL_USER: prestashop
      MYSQL_PASSWORD: \${MYSQL_PASSWORD}
      MYSQL_RANDOM_ROOT_PASSWORD: "1"
    volumes:
      - prestashop-db:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  prestashop-data:
  prestashop-db:
`,
  },
];
