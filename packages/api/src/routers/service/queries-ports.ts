import { eq } from "drizzle-orm";

import { db } from "@otterstack/db";
import { servicePort } from "@otterstack/db/schema/project";

import type { ServicePortRow } from "./queries";

export async function listServicePorts(
  serviceResourceId: string,
): Promise<ServicePortRow[]> {
  return db
    .select()
    .from(servicePort)
    .where(eq(servicePort.serviceResourceId, serviceResourceId));
}

export async function replaceServicePorts(
  serviceResourceId: string,
  ports: Array<{
    containerPort: number;
    protocol?: "tcp" | "udp";
    appProtocol?: "http" | "tcp";
    isPrimary?: boolean;
  }>,
): Promise<ServicePortRow[]> {
  return db.transaction(async (tx) => {
    await tx
      .delete(servicePort)
      .where(eq(servicePort.serviceResourceId, serviceResourceId));

    if (ports.length === 0) return [];

    return tx
      .insert(servicePort)
      .values(
        ports.map((p) => ({
          serviceResourceId,
          containerPort: p.containerPort,
          protocol: p.protocol ?? "tcp",
          appProtocol: p.appProtocol ?? "http",
          isPrimary: p.isPrimary ?? false,
        })),
      )
      .returning();
  });
}

export function getPrimaryHttpPort(
  ports: ServicePortRow[],
): ServicePortRow | undefined {
  return (
    ports.find((p) => p.isPrimary && p.appProtocol === "http") ??
    ports.find((p) => p.appProtocol === "http")
  );
}
