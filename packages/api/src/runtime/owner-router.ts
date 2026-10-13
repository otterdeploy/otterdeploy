/**
 * Per-resource runtime choice while an install moves onto otterd.
 *
 * Every resource row says who runs it (`runtime_owner`): the install's own
 * driver (`legacy`), otterd, or the migration in between (`migrating`). A
 * migrating resource is the migration's alone, so every deploy path that
 * reaches the runtime is refused with a typed error rather than racing it.
 * Once the migration is finalized, everything goes to otterd. Database
 * branching stays on the install's driver (otterd does not offer it yet).
 */
import { db } from "@otterdeploy/db";
import { otterdService } from "@otterdeploy/db/schema/otterd";
import { otterdMigrationSession } from "@otterdeploy/db/schema/otterd-migration";
import { resource } from "@otterdeploy/db/schema/project";
import { idSchema } from "@otterdeploy/shared/id";
import { eq, inArray } from "drizzle-orm";

import type { RuntimeDriver } from "./types";

import { otterdDriver } from "./otterd-driver";

type Owner = "legacy" | "migrating" | "otterd";

/** A deploy reached a resource the migration is moving. */
export class ResourceMigratingError extends Error {
  constructor(what: string) {
    super(`${what} is being migrated to otterd; try again when the migration step finishes`);
  }
}

async function finalized(): Promise<boolean> {
  const [s] = await db
    .select({ state: otterdMigrationSession.state })
    .from(otterdMigrationSession)
    .where(eq(otterdMigrationSession.state, "finalized"));
  return s !== undefined;
}

const asOwner = (o: string | undefined): Owner =>
  o === "otterd" || o === "migrating" ? o : "legacy";

/** Who runs the resource now: its row's owner, and otterd for everything once finalized. */
export async function runtimeOwnerOf(resourceId: string): Promise<Owner> {
  const id = idSchema.resource.safeParse(resourceId);
  if (!id.success) return "legacy";
  const [row] = await db
    .select({ owner: resource.runtimeOwner })
    .from(resource)
    .where(eq(resource.id, id.data));
  const owner = asOwner(row?.owner);
  return owner === "legacy" && (await finalized()) ? "otterd" : owner;
}

/** Owners of runtime service names: only names otterd knows can be otterd's. */
async function ownersByName(names: readonly string[]): Promise<Map<string, Owner>> {
  if (names.length === 0) return new Map();
  const rows = await db
    .select({ name: otterdService.serviceName, owner: resource.runtimeOwner })
    .from(otterdService)
    .innerJoin(resource, eq(resource.id, otterdService.resourceId))
    .where(inArray(otterdService.serviceName, [...names]));
  return new Map(rows.flatMap((r) => (r.name ? [[r.name, asOwner(r.owner)]] : [])));
}

async function pick(base: RuntimeDriver, owner: Owner, what: string): Promise<RuntimeDriver> {
  if (owner === "migrating") throw new ResourceMigratingError(what);
  return owner === "otterd" ? otterdDriver : base;
}

const byId = async (base: RuntimeDriver, resourceId: string) =>
  pick(base, await runtimeOwnerOf(resourceId), `resource ${resourceId}`);

/** Reads go to whoever runs it; a migrating resource is still the legacy container. */
const readerByName = async (base: RuntimeDriver, name: string) =>
  (await ownersByName([name])).get(name) === "otterd" ? otterdDriver : base;

const writerByName = async (base: RuntimeDriver, name: string) =>
  pick(base, (await ownersByName([name])).get(name) ?? "legacy", `service ${name}`);

export function ownerAware(base: RuntimeDriver): RuntimeDriver {
  return {
    kind: base.kind,
    provision: async (spec, log) => (await byId(base, spec.resourceId)).provision(spec, log),
    update: async (spec, log) => (await byId(base, spec.resourceId)).update(spec, log),
    destroy: async (input, log) =>
      (await writerByName(base, input.serviceName)).destroy(input, log),
    inspect: async (input, log) =>
      (await readerByName(base, input.serviceName)).inspect(input, log),
    async inspectMany(inputs, log) {
      const owners = await ownersByName(inputs.map((i) => i.serviceName));
      const mine = inputs.filter((i) => owners.get(i.serviceName) === "otterd");
      const theirs = inputs.filter((i) => owners.get(i.serviceName) !== "otterd");
      const [a, b] = await Promise.all([
        mine.length ? otterdDriver.inspectMany(mine, log) : new Map(),
        theirs.length ? base.inspectMany(theirs, log) : new Map(),
      ]);
      return new Map([...b, ...a]);
    },
    provisionDatabase: async (input, log) =>
      (await byId(base, input.resourceId)).provisionDatabase(input, log),
    updateDatabase: async (input, log) =>
      (await byId(base, input.resourceId)).updateDatabase(input, log),
    destroyDatabase: async (input, log) =>
      (await writerByName(base, input.serviceName)).destroyDatabase(input, log),
    inspectDatabase: async (input, log) =>
      (await readerByName(base, input.serviceName)).inspectDatabase(input, log),
    branchDatabase: (input, log) => base.branchDatabase(input, log),
    destroyDatabaseBranch: (input, log) => base.destroyDatabaseBranch(input, log),
  };
}
