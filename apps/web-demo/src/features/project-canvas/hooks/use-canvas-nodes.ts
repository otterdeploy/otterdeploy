import type { DatabaseFromApi, ProxyRouteFromApi } from "../api/schema";
import type { CanvasNode } from "../types";

const GROUP_ID = "group:data";
const ROUTING_ID = "node:routing";
const GROUP_POSITION = { x: 40, y: 40 } as const;
const ROUTING_POSITION = { x: 440, y: 40 } as const;
const DATABASE_INNER_X = 20;
const VOLUME_INNER_X = 20;
const ROW_HEIGHT = 180;

interface Input {
  databases: ReadonlyArray<DatabaseFromApi>;
  proxyRoutes: ReadonlyArray<ProxyRouteFromApi>;
}

export function useCanvasNodes(input: Input): { nodes: CanvasNode[] } {
  const { databases, proxyRoutes } = input;
  const groupHeight = Math.max(200, databases.length * ROW_HEIGHT + 60);

  const group: CanvasNode = {
    id: GROUP_ID,
    type: "group",
    position: GROUP_POSITION,
    data: { kind: "group", label: "data" },
    style: { width: 360, height: groupHeight },
  };

  const routing: CanvasNode = {
    id: ROUTING_ID,
    type: "routing",
    position: ROUTING_POSITION,
    data: {
      kind: "routing",
      domains: proxyRoutes
        .filter((r) => r.enabled)
        .map((r) => ({ domain: r.domain, type: r.type })),
    },
  };

  const dbAndVolumeNodes: CanvasNode[] = databases.flatMap((database, index) => {
    const databaseId = `db:${database.resourceId}`;
    const volumeId = `vol:${database.resourceId}`;
    const dbY = 50 + index * ROW_HEIGHT;
    const volumeY = dbY + 90;
    const dbNode: CanvasNode = {
      id: databaseId,
      type: "database",
      parentId: GROUP_ID,
      extent: "parent",
      position: { x: DATABASE_INNER_X, y: dbY },
      data: {
        kind: "database",
        resourceId: database.resourceId,
        name: database.name,
        engine: "postgres",
        status: database.runtime.status,
        health: database.runtime.health,
        publicHostname: database.publicHostname,
        internalHostname: database.internalHostname,
        volumeName: database.runtime.volumeName,
      },
    };
    const volumeNode: CanvasNode = {
      id: volumeId,
      type: "volume",
      parentId: GROUP_ID,
      extent: "parent",
      position: { x: VOLUME_INNER_X, y: volumeY },
      data: {
        kind: "volume",
        source: database.runtime.volumeName,
        target: "/var/lib/postgresql/data",
      },
    };
    return [dbNode, volumeNode];
  });

  return { nodes: [group, routing, ...dbAndVolumeNodes] };
}
