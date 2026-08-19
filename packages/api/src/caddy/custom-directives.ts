import { customDirectivesSchema } from "@otterdeploy/shared/custom-directives";

/** The user's raw directive lines, indented one level into the site block.
 *  Re-parsed through the write-boundary schema: a stored value that bypassed
 *  it (manual DB edit, older row) degrades to NO block here rather than
 *  corrupting the entire edge config — one route's text must never take down
 *  every other site. Caddy's /adapt pass stays the final syntax gate. */
export function customDirectiveLines(raw: string | null | undefined): string[] {
  const parsed = customDirectivesSchema.safeParse(raw ?? "");
  if (!parsed.success || parsed.data === "") return [];
  return parsed.data.split("\n").map((line) => (line === "" ? "" : `\t${line}`));
}
