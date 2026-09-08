/**
 * `environmentIdForSlug`, with its unknown-slug throw turned into the
 * manifest contract's BAD_REQUEST.
 *
 * Its own module so every manifest endpoint that accepts `environment` shares
 * one conversion: a plan previewed for one environment and executed against
 * another is the exact failure the refusal exists to prevent, and two copies
 * of this could drift apart.
 */
import { UnknownEnvironmentError, environmentIdForSlug } from "./resolve-slug";

export async function environmentIdOrReject(
  projectId: Parameters<typeof environmentIdForSlug>[0],
  slug: string | null | undefined,
  errors: { BAD_REQUEST: (init?: { message?: string }) => Error },
) {
  try {
    return await environmentIdForSlug(projectId, slug);
  } catch (error) {
    if (error instanceof UnknownEnvironmentError) {
      throw errors.BAD_REQUEST({ message: error.message });
    }
    throw error;
  }
}
