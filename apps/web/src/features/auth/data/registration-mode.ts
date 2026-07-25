import { env } from "@otterdeploy/env/web";

export type RegistrationMode = "bootstrap" | "invite-only";

export async function fetchRegistrationMode(): Promise<RegistrationMode> {
  const response = await fetch(`${env.VITE_SERVER_URL}/api/auth/bootstrap-status`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Unable to read registration status");
  const body = (await response.json()) as { mode?: unknown };
  if (body.mode !== "bootstrap" && body.mode !== "invite-only") {
    throw new Error("Invalid registration status");
  }
  return body.mode;
}
