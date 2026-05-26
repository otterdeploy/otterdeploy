/**
 * Constants shared across every domain slice of the project contract.
 *
 * `tag` controls how endpoints are grouped in the generated OpenAPI doc;
 * `basePath` is the URL prefix every route lives under so the slices can
 * compose paths without restating the prefix.
 */

export const tag = "project";
export const basePath = "/projects";

/** Stock error map for "this resource doesn't belong to your org or doesn't exist." */
export const projectNotFoundErrors = {
  NOT_FOUND: {
    status: 404 as const,
    message: "Project not found" as const,
  },
};

/** Same for inner-resource lookups under a project. */
export const resourceNotFoundErrors = {
  NOT_FOUND: {
    status: 404 as const,
    message: "Resource not found" as const,
  },
};
