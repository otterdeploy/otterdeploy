import type { client } from "@/utils/orpc";

export type ProjectFromApi = Awaited<ReturnType<typeof client.project.get>>;
export type DatabaseFromApi = Awaited<
  ReturnType<typeof client.project.database.postgres.list>
>[number];
export type ProxyRouteFromApi = Awaited<ReturnType<typeof client.project.proxyRoute.list>>[number];
