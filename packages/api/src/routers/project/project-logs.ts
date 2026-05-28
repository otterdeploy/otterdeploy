// Server-side fan-in for the project-wide /logs page. Snapshots the
// project's services at subscribe time, opens one docker `services/{id}/logs`
// stream per service, and merges every demuxed line into one async generator
// tagged with the source resource id + service name.
//
// Why snapshot, not auto-discover new resources: a single subscription that
// outlives resource creation would mean reconciling docker subscriptions
// while the iterator is in flight. The /logs page can reconnect on resource
// changes from the live resource collection instead — much simpler, and the
// gap is bounded to one reconnect.
import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { Docker } from "@otterdeploy/docker";

import { getProjectInOrg, getProjectRecord, listProjectResources } from "./queries";

import { buildContainerName } from "./views";
import { demuxDockerLogs } from "./resource-logs";

type OrgId = OrganizationId;

interface ProjectLogsRef {
  projectId: ProjectId;
  organizationId: OrgId;
  resourceIds?: ResourceId[];
  tail?: number;
}

export interface ProjectLogEvent {
  stream: "stdout" | "stderr" | "system";
  line: string;
  ts: string | null;
  resourceId: string;
  serviceName: string;
}

interface TargetService {
  resourceId: ResourceId;
  serviceName: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function resolveTargets(
  projectId: ProjectId,
  resourceIds: ResourceId[] | undefined,
): Promise<TargetService[]> {
  const { databases, services } = await listProjectResources(projectId);
  const project = await getProjectRecord(projectId);
  const slug = project?.slug ?? projectId;

  const wanted = resourceIds ? new Set<string>(resourceIds) : null;

  // Databases only stream when explicitly named in the filter — the default
  // project-wide view shows services only, since postgres has its own log
  // surface on the resource detail panel and operators usually don't want
  // engine startup chatter mixed in with app logs.
  const dbTargets: TargetService[] = databases
    .filter((d) => (wanted ? wanted.has(d.resource.id) : false))
    .map((d) => ({
      resourceId: d.resource.id as ResourceId,
      serviceName: buildContainerName({
        engine: d.database.engine,
        projectSlug: slug,
        resourceName: d.resource.name,
      }),
    }));

  const svcTargets: TargetService[] = services
    .filter((s) => (wanted ? wanted.has(s.resource.id) : true))
    .map((s) => ({
      resourceId: s.resource.id as ResourceId,
      serviceName: s.service.serviceName,
    }));

  return [...svcTargets, ...dbTargets];
}

function systemEvent(
  target: TargetService,
  line: string,
): ProjectLogEvent {
  return {
    stream: "system",
    line: `[${target.serviceName}] ${line}`,
    ts: nowIso(),
    resourceId: target.resourceId,
    serviceName: target.serviceName,
  };
}

// Open one services/{id}/logs stream and push each demuxed event into the
// shared queue. Returns a cleanup that destroys the docker client.
function pumpServiceLogs(
  target: TargetService,
  tailCount: number,
  push: (ev: ProjectLogEvent) => void,
  onClose: () => void,
  signal: AbortSignal,
): () => void {
  const docker = Docker.fromEnv();
  let cancelled = false;

  void (async () => {
    try {
      const listResult = await docker.services.list({
        filters: { name: [target.serviceName] },
      });
      if (listResult.isErr()) {
        push(systemEvent(target, `services.list failed: ${listResult.error.message}`));
        return;
      }
      const found = listResult.value.find(
        (s) => (s as { Spec?: { Name?: string } }).Spec?.Name === target.serviceName,
      );
      const serviceId = (found as { ID?: string } | undefined)?.ID;
      if (!serviceId) {
        push(systemEvent(target, "no swarm service yet"));
        return;
      }

      const logsResult = await docker.services.getService(serviceId).logs({
        follow: true,
        stdout: true,
        stderr: true,
        tail: String(tailCount),
        timestamps: true,
      });
      if (logsResult.isErr()) {
        push(systemEvent(target, `services.logs failed: ${logsResult.error.message}`));
        return;
      }

      for await (const ev of demuxDockerLogs(logsResult.value)) {
        if (cancelled || signal.aborted) break;
        push({
          stream: ev.stream,
          line: ev.line,
          ts: ev.ts,
          resourceId: target.resourceId,
          serviceName: target.serviceName,
        });
      }
    } catch (err) {
      if (cancelled || signal.aborted) return;
      push(
        systemEvent(
          target,
          `stream error: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    } finally {
      onClose();
      docker.destroy();
    }
  })();

  return () => {
    cancelled = true;
    docker.destroy();
  };
}

export async function* tailProjectLogs(
  input: ProjectLogsRef,
): AsyncGenerator<ProjectLogEvent, void, void> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    yield {
      stream: "system",
      line: "Project not found",
      ts: nowIso(),
      resourceId: "" as ResourceId,
      serviceName: "",
    };
    return;
  }

  const targets = await resolveTargets(input.projectId, input.resourceIds);
  if (targets.length === 0) {
    yield {
      stream: "system",
      line: "No services in this project yet",
      ts: nowIso(),
      resourceId: "" as ResourceId,
      serviceName: "",
    };
    return;
  }

  // Pumped events live in queue; the outer generator wakes up via `notify`
  // and drains. No bound — backpressure flows from the client through the
  // orpc event-iterator transport.
  const queue: ProjectLogEvent[] = [];
  let notify: (() => void) | null = null;
  let activePumps = targets.length;
  const abort = new AbortController();

  const wakeup = () => {
    const fn = notify;
    notify = null;
    fn?.();
  };

  const push = (ev: ProjectLogEvent) => {
    queue.push(ev);
    wakeup();
  };
  const onClose = () => {
    activePumps -= 1;
    if (activePumps <= 0) wakeup();
  };

  yield {
    stream: "system",
    line: `Tailing ${targets.length} service${targets.length === 1 ? "" : "s"} in ${project.name}`,
    ts: nowIso(),
    resourceId: "" as ResourceId,
    serviceName: "",
  };

  const cleanups = targets.map((t) =>
    pumpServiceLogs(t, input.tail ?? 50, push, onClose, abort.signal),
  );

  try {
    while (true) {
      const next = queue.shift();
      if (next) {
        yield next;
        continue;
      }
      if (activePumps <= 0) return;
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }
  } finally {
    abort.abort();
    for (const c of cleanups) c();
  }
}
