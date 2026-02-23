export interface CaddyRoute {
  "@id"?: string;
  match?: Array<{ host?: string[]; path?: string[] }>;
  handle: CaddyHandler[];
  terminal?: boolean;
}

export interface CaddyHandler {
  handler: string;
  [key: string]: unknown;
}

export interface CaddyConfig {
  apps?: {
    http?: {
      servers?: Record<
        string,
        {
          listen: string[];
          routes: CaddyRoute[];
        }
      >;
    };
  };
  admin?: { listen?: string };
}

export interface RouteTarget {
  resourceId: string;
  domain: string;
  upstream: string; // e.g. "otterstack-{resourceId}"
  port: number;
}

export interface RouteOpts {
  compression?: boolean;
  securityHeaders?: boolean;
  pathPrefix?: string;
}
