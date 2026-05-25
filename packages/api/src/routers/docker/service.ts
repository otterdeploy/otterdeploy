import { Docker } from "@otterdeploy/docker";

const docker = Docker.fromEnv();

export interface ListedContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  createdAt: number;
}

export async function listContainers(opts: {
  all?: boolean;
}): Promise<
  | { ok: true; containers: ListedContainer[] }
  | { ok: false; reason: string }
> {
  const result = await docker.containers.list({ all: opts.all ?? false });
  if (result.isErr()) {
    return { ok: false, reason: result.error.message };
  }
  const containers: ListedContainer[] = result.value.map((c) => ({
    id: c.Id,
    name: (c.Names?.[0] ?? c.Id).replace(/^\//, ""),
    image: c.Image,
    state: c.State,
    status: c.Status,
    createdAt: c.Created,
  }));
  return { ok: true, containers };
}
