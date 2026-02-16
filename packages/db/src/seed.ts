import { eq, isTable } from "drizzle-orm";
import { reset, seed } from "drizzle-seed";

import { db } from "./index";
import * as schema from "./schema";
import { project, projectEnvironment, projectViewport } from "./schema/architecture";
import { deploymentSecretSnapshot, secretProviderBinding } from "./schema/secrets";

const DEFAULT_COUNT = 20;
const DEFAULT_SEED = 20260216;

type SeedOptions = {
  reset: boolean;
  count: number;
  seed: number;
};

const parseIntegerFlag = (args: string[], flag: "--count" | "--seed"): number | undefined => {
  const prefixed = args.find((arg) => arg.startsWith(`${flag}=`));
  if (prefixed) {
    const value = Number.parseInt(prefixed.split("=")[1] ?? "", 10);
    return Number.isNaN(value) ? undefined : value;
  }

  const index = args.indexOf(flag);
  if (index === -1) return undefined;

  const value = Number.parseInt(args[index + 1] ?? "", 10);
  return Number.isNaN(value) ? undefined : value;
};

const parseOptions = (argv: string[]): SeedOptions => {
  const args = argv.slice(2);
  const count = parseIntegerFlag(args, "--count") ?? DEFAULT_COUNT;
  const seedValue = parseIntegerFlag(args, "--seed") ?? DEFAULT_SEED;
  const shouldReset = args.includes("--reset");

  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("Invalid --count value. Use a positive integer.");
  }

  if (!Number.isInteger(seedValue)) {
    throw new Error("Invalid --seed value. Use an integer.");
  }

  return {
    reset: shouldReset,
    count,
    seed: seedValue,
  };
};

// Tables excluded from auto-seed:
// - projectViewport: cyclic not-null FK with projectEnvironment
// - secretProviderBinding: unique constraint on organizationId (1 per org)
const excludedTables = new Set([projectViewport, secretProviderBinding, deploymentSecretSnapshot]);

const seedSchema = Object.fromEntries(
  Object.entries(schema).filter(([, value]) => isTable(value) && !excludedTables.has(value as never)),
);

const run = async () => {
  const options = parseOptions(process.argv);

  if (options.reset) {
    console.info("Resetting tables...");
    await reset(db, seedSchema);
  }

  console.info(`Seeding database (count=${options.count}, seed=${options.seed})...`);
  await seed(db, seedSchema, {
    count: options.count,
    seed: options.seed,
  });
  // Ensure every project has a "production" environment
  const allProjects = await db.select({ id: project.id }).from(project);
  const projectsWithProd = await db
    .select({ projectId: projectEnvironment.projectId })
    .from(projectEnvironment)
    .where(eq(projectEnvironment.name, "production"));

  const projectsWithProdIds = new Set(projectsWithProd.map((r) => r.projectId));
  const missing = allProjects.filter((p) => !projectsWithProdIds.has(p.id));

  if (missing.length > 0) {
    const now = new Date();
    await db.insert(projectEnvironment).values(
      missing.map((p) => ({
        id: crypto.randomUUID(),
        projectId: p.id,
        name: "production",
        createdAt: now,
        updatedAt: now,
      })),
    );
    console.info(`Created "production" environment for ${missing.length} project(s).`);
  }

  console.info("Database seeding complete.");
};

run().catch((error) => {
  console.error("Database seeding failed.");
  console.error(error);
  process.exit(1);
});
