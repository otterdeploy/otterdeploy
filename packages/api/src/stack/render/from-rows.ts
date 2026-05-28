/**
 * Build a typed {@link StackFile} from the live row state of a project.
 *
 * Read-only: this function never writes. Each database resource and each
 * service resource maps to one entry under `services.<key>`. The entry
 * carries an `x-otterdeploy:` extension block stamping the IDs +
 * engine + public-exposure flag so a future round-trip (file → DB) is
 * lossless.
 *
 * Database services use the engine adapter for image / env / healthcheck /
 * mount path / port so the renderer stays single-source-of-truth with the
 * apply path.
 */

import {
  buildContainerName,
  buildVolumeName,
} from "../../routers/project/views";
import {
  getProjectRecord,
  listDatabaseResourceRecords,
} from "../../routers/project/queries";
import { listServiceRecordsByProject } from "../../routers/service/queries";
import { type ProjectId } from "../../routers/project/errors";

import {
  STACK_FILE_SCHEMA_VERSION,
  type StackFile,
  type StackService,
} from "../schema";

import { buildDatabaseService } from "./from-rows-database";
import { buildServiceEntry } from "./from-rows-service";
import { projectNetworkName } from "./network-name";

type DatabaseRows = Awaited<ReturnType<typeof listDatabaseResourceRecords>>;
type ServiceRecords = Awaited<ReturnType<typeof listServiceRecordsByProject>>;

function renderDatabases(
  rows: DatabaseRows,
  projectSlug: string,
  out: Record<string, StackService>,
  volumes: Record<string, Record<string, never>>,
): void {
  for (const row of rows) {
    const containerName = buildContainerName({
      projectSlug,
      resourceName: row.resource.name,
    });
    const volumeName = buildVolumeName({
      projectSlug,
      resourceName: row.resource.name,
    });
    volumes[volumeName] = {};
    const entry = buildDatabaseService(row, projectSlug, volumeName);
    // Self-describing service name as a deploy label so the swarm side
    // can be located without a parallel name table.
    entry.deploy = {
      ...entry.deploy,
      labels: { "otterdeploy.service.name": containerName },
    };
    out[row.resource.name] = entry;
  }
}

function renderServices(
  records: ServiceRecords,
  projectSlug: string,
  out: Record<string, StackService>,
): void {
  for (const record of records) {
    out[record.resource.name] = buildServiceEntry(record, projectSlug);
  }
}

export async function renderProjectFromRows(
  projectId: ProjectId,
): Promise<StackFile> {
  const project = await getProjectRecord(projectId);
  const projectSlug = project?.slug ?? projectId;

  const [databases, services] = await Promise.all([
    listDatabaseResourceRecords(projectId),
    listServiceRecordsByProject(projectId),
  ]);

  const stackServices: Record<string, StackService> = {};
  const volumes: Record<string, Record<string, never>> = {};

  renderDatabases(databases, projectSlug, stackServices, volumes);
  renderServices(services, projectSlug, stackServices);

  return {
    version: STACK_FILE_SCHEMA_VERSION,
    services: stackServices,
    networks: {
      [projectNetworkName(projectSlug)]: {
        driver: "overlay",
        attachable: true,
      },
    },
    volumes: Object.keys(volumes).length > 0 ? volumes : undefined,
  };
}
