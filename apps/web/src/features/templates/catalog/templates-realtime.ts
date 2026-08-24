// Real-time media infrastructure. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const REALTIME_TEMPLATES: StackTemplate[] = [
  {
    id: "livekit",
    name: "LiveKit",
    descriptionKey: "templates.catalog.livekit.description",
    category: "communication",
    includes: ["livekit", "redis"],
    requiredEnv: [
      {
        key: "LIVEKIT_API_KEY",
        descriptionKey: "templates.catalog.livekit.env.LIVEKIT_API_KEY",
        generateHint: "openssl rand -hex 8",
      },
      {
        key: "LIVEKIT_API_SECRET",
        descriptionKey: "templates.catalog.livekit.env.LIVEKIT_API_SECRET",
        generateHint: "openssl rand -base64 36",
      },
    ],
    logoBrand: "LiveKit",
    docsUrl: "https://docs.livekit.io/transport/self-hosting/deployment/",
    /*
     * `rtc.udp_port` is what makes this deployable at all.
     *
     * LiveKit's default is `port_range_start/end: 50000-60000` — two UDP ports
     * per participant. Compose expresses that as a port RANGE, and this
     * platform does not support ranges — the parser drops them (silently, until
     * PR #189 makes the drop warn). UDP mux collapses every participant's media
     * onto the single port 7882 instead, and when it is set the range is not
     * used at all. That is upstream's own recommendation for containerised
     * deployments, not a workaround invented here.
     *
     * `use_external_ip: true` matters just as much: the server has to advertise
     * an ICE candidate reachable from the outside, and inside a container the
     * address it can see is not that. With it, LiveKit resolves its public
     * address over STUN at boot. Without it, clients connect, negotiate, and
     * then sit in silence.
     *
     * Redis holds ephemeral node and room registrations, so it deliberately
     * gets no volume: persisting it across a restart means booting with stale
     * routing for nodes that no longer exist. It is here because every LiveKit
     * add-on (egress, ingress, SIP) coordinates through it, so adding one later
     * is a config change rather than a re-architecture.
     */
    compose: `name: livekit
services:
  livekit:
    image: livekit/livekit-server:v1.13.5
    depends_on:
      - redis
    environment:
      LIVEKIT_CONFIG: |
        port: 7880
        log_level: info
        rtc:
          tcp_port: 7881
          udp_port: 7882
          use_external_ip: true
        redis:
          address: "\${{stack.redis.HOST}}:6379"
        keys:
          \${LIVEKIT_API_KEY}: \${LIVEKIT_API_SECRET}
    ports:
      - "7880"
      - "7881"
      - "7882/udp"
    restart: always
  redis:
    image: redis:7-alpine
    command: ["redis-server", "--save", "", "--appendonly", "no"]
    restart: always
`,
  },
];
