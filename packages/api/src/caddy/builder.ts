export type ProxyRouteInput = {
  projectId: string;
  type: "http" | "layer4";
  domain: string;
  upstreamHost: string;
  upstreamPort: number;
  protocol: "tcp" | "http";
  layer4Alpn: string | null;
};

export type CaddyConfig = {
  admin: { listen: string };
  apps: {
    layer4?: ReturnType<typeof buildLayer4App>;
    http?: ReturnType<typeof buildHttpApp>;
  };
};

export function buildCaddyConfig(routes: ProxyRouteInput[], adminBind: string): CaddyConfig {
  const httpRoutes = routes.filter((r) => r.type === "http");
  const layer4Routes = routes.filter((r) => r.type === "layer4");

  const apps: Record<string, unknown> = {};

  if (layer4Routes.length > 0) {
    apps.layer4 = buildLayer4App(layer4Routes);
  }

  if (httpRoutes.length > 0) {
    apps.http = buildHttpApp(httpRoutes);
  }

  return {
    admin: { listen: adminBind },
    apps,
  };
}

export function buildLayer4App(routes: ProxyRouteInput[]) {
  return {
    servers: {
      postgres: {
        listen: [":5432"],
        routes: routes.map((route) => buildLayer4Route(route)),
      },
    },
  };
}

export function buildLayer4Route(route: ProxyRouteInput) {
  return {
    match: [
      {
        tls: {
          sni: [route.domain],
        },
      },
    ],
    handle: [
      { handler: "tls" },
      {
        handler: "proxy",
        upstreams: [{ dial: [`${route.upstreamHost}:${route.upstreamPort}`] }],
      },
    ],
  };
}

export function buildHttpApp(routes: ProxyRouteInput[]) {
  return {
    servers: {
      web: {
        listen: [":443"],
        routes: routes.map((route) => ({
          match: [{ host: [route.domain] }],
          handle: [
            {
              handler: "reverse_proxy",
              upstreams: [{ dial: `${route.upstreamHost}:${route.upstreamPort}` }],
            },
          ],
        })),
      },
    },
  };
}

export function buildProjectConfig(routes: ProxyRouteInput[]): CaddyConfig {
  return buildCaddyConfig(routes, "off");
}
