/**
 * The organization a request acts in, as the client states it.
 *
 * A session has ONE active organization, shared by every tab and window that
 * carries its cookie. A page belongs to the organization in its URL. The two
 * part ways the moment another tab switches the session: the page still shows
 * organization A, the session now resolves organization B, and a save sent
 * from A's page (a base domain, an API key, a new server) used to land in B,
 * an organization the page the user was looking at never showed.
 *
 * So the client says which organization it is acting in, and an org-scoped
 * procedure refuses a request whose organization is not the session's active
 * one, rather than quietly acting in the other. Two ways to say it:
 *
 *   - the `x-otterdeploy-organization` header, which the dashboard sets on
 *     every call from a page under `/$orgSlug` (apps/web shared/server);
 *   - an `organizationId` in the procedure's own input (the organization
 *     settings procedures carry it in their REST path).
 *
 * Neither CHOOSES the organization: the session (or an API key's owning
 * organization) still decides where a request acts, and membership is still
 * checked against it. The stated organization only has to agree.
 *
 * Kept free of server imports: the dashboard imports the header name.
 */

/** Request header: the organization the calling page or command acts in. */
export const ACTING_ORGANIZATION_HEADER = "x-otterdeploy-organization";

/** The refusal's code, so a client can tell it apart from other conflicts. */
export const ORGANIZATION_SWITCHED = "ORGANIZATION_SWITCHED";

/**
 * Every organization the request says it acts in: the header, and an
 * `organizationId` string in the input. Empty when it names none (an API call,
 * the CLI, a page outside any organization). Each must be the active one.
 */
export function statedOrganizationsOf(headers: Headers, input: unknown): string[] {
  const stated: string[] = [];
  const header = headers.get(ACTING_ORGANIZATION_HEADER)?.trim();
  if (header) stated.push(header);
  if (typeof input === "object" && input !== null) {
    const named: unknown = Reflect.get(input, "organizationId");
    if (typeof named === "string") stated.push(named);
  }
  return stated;
}
