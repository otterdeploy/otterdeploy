// Real-time meetings. Split out of templates-communication.ts to keep each
// catalog file readable; see ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const CONFERENCING_TEMPLATES: StackTemplate[] = [
  {
    id: "jitsi",
    name: "Jitsi Meet",
    descriptionKey: "templates.catalog.jitsi.description",
    category: "communication",
    includes: ["web", "prosody", "jicofo", "jvb"],
    requiredEnv: [
      { key: "JITSI_PUBLIC_URL", descriptionKey: "templates.catalog.jitsi.env.JITSI_PUBLIC_URL" },
      {
        key: "JVB_ADVERTISE_IP",
        descriptionKey: "templates.catalog.jitsi.env.JVB_ADVERTISE_IP",
        generateHint: "curl -s https://ifconfig.me",
      },
      {
        key: "JICOFO_AUTH_PASSWORD",
        descriptionKey: "templates.catalog.jitsi.env.JICOFO_AUTH_PASSWORD",
        generateHint: "openssl rand -hex 16",
      },
      {
        key: "JICOFO_COMPONENT_SECRET",
        descriptionKey: "templates.catalog.jitsi.env.JICOFO_COMPONENT_SECRET",
        generateHint: "openssl rand -hex 16",
      },
      {
        key: "JVB_AUTH_PASSWORD",
        descriptionKey: "templates.catalog.jitsi.env.JVB_AUTH_PASSWORD",
        generateHint: "openssl rand -hex 16",
      },
    ],
    logoBrand: "Jitsi Meet",
    docsUrl: "https://jitsi.github.io/handbook/docs/devops-guide/devops-guide-docker/",
    // The three XMPP passwords are shared secrets: prosody creates the accounts
    // from them and jicofo/jvb authenticate with them, so the same value has to
    // appear on both sides. They are prompted once and interpolated everywhere.
    compose: `name: jitsi
services:
  web:
    image: jitsi/web:stable-10133
    depends_on:
      - prosody
    environment:
      TZ: UTC
      PUBLIC_URL: \${JITSI_PUBLIC_URL}
      DISABLE_HTTPS: "1"
      ENABLE_LETSENCRYPT: "0"
      XMPP_SERVER: "\${{stack.prosody.HOST}}"
      XMPP_BOSH_URL_BASE: "http://\${{stack.prosody.HOST}}:5280"
      XMPP_DOMAIN: meet.jitsi
      XMPP_AUTH_DOMAIN: auth.meet.jitsi
      XMPP_MUC_DOMAIN: muc.meet.jitsi
      XMPP_GUEST_DOMAIN: guest.meet.jitsi
      XMPP_RECORDER_DOMAIN: recorder.meet.jitsi
      XMPP_INTERNAL_MUC_DOMAIN: internal-muc.meet.jitsi
      JICOFO_AUTH_USER: focus
    ports:
      - "80"
    volumes:
      - jitsi-web-config:/config
      - jitsi-web-crontabs:/var/spool/cron/crontabs
    restart: always
  prosody:
    image: jitsi/prosody:stable-10133
    environment:
      TZ: UTC
      AUTH_TYPE: internal
      ENABLE_AUTH: "0"
      ENABLE_GUESTS: "1"
      PUBLIC_URL: \${JITSI_PUBLIC_URL}
      XMPP_DOMAIN: meet.jitsi
      XMPP_AUTH_DOMAIN: auth.meet.jitsi
      XMPP_MUC_DOMAIN: muc.meet.jitsi
      XMPP_GUEST_DOMAIN: guest.meet.jitsi
      XMPP_RECORDER_DOMAIN: recorder.meet.jitsi
      XMPP_INTERNAL_MUC_DOMAIN: internal-muc.meet.jitsi
      JICOFO_AUTH_USER: focus
      JICOFO_AUTH_PASSWORD: \${JICOFO_AUTH_PASSWORD}
      JICOFO_COMPONENT_SECRET: \${JICOFO_COMPONENT_SECRET}
      JVB_AUTH_USER: jvb
      JVB_AUTH_PASSWORD: \${JVB_AUTH_PASSWORD}
    volumes:
      - jitsi-prosody-config:/config
      - jitsi-prosody-plugins:/prosody-plugins-custom
    restart: always
  jicofo:
    image: jitsi/jicofo:stable-10133
    depends_on:
      - prosody
    environment:
      TZ: UTC
      XMPP_SERVER: "\${{stack.prosody.HOST}}"
      XMPP_DOMAIN: meet.jitsi
      XMPP_AUTH_DOMAIN: auth.meet.jitsi
      XMPP_MUC_DOMAIN: muc.meet.jitsi
      XMPP_INTERNAL_MUC_DOMAIN: internal-muc.meet.jitsi
      JICOFO_AUTH_USER: focus
      JICOFO_AUTH_PASSWORD: \${JICOFO_AUTH_PASSWORD}
      JICOFO_COMPONENT_SECRET: \${JICOFO_COMPONENT_SECRET}
    volumes:
      - jitsi-jicofo-config:/config
    restart: always
  jvb:
    image: jitsi/jvb:stable-10133
    depends_on:
      - prosody
    environment:
      TZ: UTC
      XMPP_SERVER: "\${{stack.prosody.HOST}}"
      XMPP_AUTH_DOMAIN: auth.meet.jitsi
      XMPP_INTERNAL_MUC_DOMAIN: internal-muc.meet.jitsi
      XMPP_INTERNAL_MUC_MODULES: ""
      JVB_AUTH_USER: jvb
      JVB_AUTH_PASSWORD: \${JVB_AUTH_PASSWORD}
      JVB_PORT: "10000"
      DOCKER_HOST_ADDRESS: \${JVB_ADVERTISE_IP}
    ports:
      - "10000/udp"
    volumes:
      - jitsi-jvb-config:/config
    restart: always
volumes:
  jitsi-web-config:
  jitsi-web-crontabs:
  jitsi-prosody-config:
  jitsi-prosody-plugins:
  jitsi-jicofo-config:
  jitsi-jvb-config:
`,
  },
];
