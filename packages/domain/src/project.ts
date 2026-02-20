import { Result } from "better-result";
import { db, eq, and, desc, sql } from "@otterdeploy/db";
import {
  project,
  projectEnvironment,
  projectViewport,
} from "@otterdeploy/db/schema/architecture";

import { NotFoundError, ConflictError } from "./errors";
import { pickDefined } from "./utils";

function createId() {
  return crypto.randomUUID();
}

function slugify(name: string) {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
  return normalized || "project";
}

async function generateUniqueSlug(
  base: string,
  checkFn: (slug: string) => Promise<boolean>,
): Promise<Result<string, ConflictError>> {
  let candidate = slugify(base);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const exists = await checkFn(candidate);
    if (!exists) return Result.ok(candidate);
    candidate = `${slugify(base)}-${Math.floor(Math.random() * 10_000)}`;
  }
  return Result.err(new ConflictError({ resource: "slug", detail: "Could not generate a unique slug" }));
}

function formatProject(row: typeof project.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId!,
    ownerId: row.ownerId,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function paginationMeta(page: number, pageSize: number, total: number) {
  return {
    pagination: {
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
      total,
    },
  };
}

export async function createProject(params: {
  organizationId: string;
  ownerId: string;
  name: string;
  slug?: string;
}): Promise<Result<ReturnType<typeof formatProject>, ConflictError>> {
  const slugResult = await generateUniqueSlug(params.slug ?? params.name, async (candidate) => {
    const existing = await db.query.project.findFirst({
      where: and(eq(project.organizationId, params.organizationId), eq(project.slug, candidate)),
    });
    return !!existing;
  });
  if (slugResult.isErr()) return slugResult;
  const slug = slugResult.value;

  const now = new Date();
  const newProject = {
    id: createId(),
    organizationId: params.organizationId,
    ownerId: params.ownerId,
    name: params.name,
    slug,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(project).values(newProject);

  const environment = {
    id: createId(),
    projectId: newProject.id,
    name: "production",
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(projectEnvironment).values(environment);

  await db.insert(projectViewport).values({
    environmentId: environment.id,
    x: 0,
    y: 0,
    zoom: 1,
    updatedAt: now,
  });

  return Result.ok(formatProject({ ...newProject, deletedAt: null }));
}

export async function getProjectById(
  projectId: string,
  organizationId: string,
): Promise<Result<ReturnType<typeof formatProject>, NotFoundError>> {
  const row = await db.query.project.findFirst({
    where: and(eq(project.id, projectId), eq(project.organizationId, organizationId)),
  });
  if (!row) return Result.err(new NotFoundError({ resource: "project", id: projectId }));
  return Result.ok(formatProject(row));
}

export async function listProjects(
  organizationId: string,
  page: number,
  pageSize: number,
) {
  const offset = (page - 1) * pageSize;

  const [items, [countRow]] = await Promise.all([
    db.query.project.findMany({
      where: eq(project.organizationId, organizationId),
      orderBy: [desc(project.createdAt)],
      limit: pageSize,
      offset,
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(project)
      .where(eq(project.organizationId, organizationId)),
  ]);

  return {
    items: items.map(formatProject),
    meta: paginationMeta(page, pageSize, countRow?.count ?? 0),
  };
}

export async function updateProject(params: {
  projectId: string;
  organizationId: string;
  name?: string;
  slug?: string;
}): Promise<Result<ReturnType<typeof formatProject>, NotFoundError | ConflictError>> {
  const existing = await db.query.project.findFirst({
    where: and(eq(project.id, params.projectId), eq(project.organizationId, params.organizationId)),
  });
  if (!existing) return Result.err(new NotFoundError({ resource: "project", id: params.projectId }));

  if (params.slug !== undefined) {
    const slugConflict = await db.query.project.findFirst({
      where: and(
        eq(project.organizationId, params.organizationId),
        eq(project.slug, params.slug),
      ),
    });
    if (slugConflict && slugConflict.id !== params.projectId) {
      return Result.err(new ConflictError({ resource: "project", detail: "Slug already in use" }));
    }
  }

  await db
    .update(project)
    .set({
      updatedAt: new Date(),
      ...pickDefined({
        name: params.name,
        slug: params.slug,
      }),
    })
    .where(eq(project.id, params.projectId));

  const updated = await db.query.project.findFirst({
    where: eq(project.id, params.projectId),
  });
  if (!updated) return Result.err(new NotFoundError({ resource: "project", id: params.projectId }));

  return Result.ok(formatProject(updated));
}

export async function deleteProject(
  projectId: string,
  organizationId: string,
): Promise<Result<{ success: true }, NotFoundError>> {
  const existing = await db.query.project.findFirst({
    where: and(eq(project.id, projectId), eq(project.organizationId, organizationId)),
  });
  if (!existing) return Result.err(new NotFoundError({ resource: "project", id: projectId }));

  await db.delete(project).where(eq(project.id, projectId));
  return Result.ok({ success: true as const });
}
