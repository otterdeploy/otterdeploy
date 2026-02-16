import { env } from "@otterstack/env/server";

type GatewayResponse<T> = {
  data: T;
};

function ensureGatewayConfig() {
  if (!env.INFISICAL_GATEWAY_URL) {
    throw new Error("INFISICAL_GATEWAY_URL is not configured");
  }
}

function getGatewayAuthHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (env.INFISICAL_GATEWAY_TOKEN) {
    headers.Authorization = `Bearer ${env.INFISICAL_GATEWAY_TOKEN}`;
    return headers;
  }

  if (
    env.INFISICAL_MACHINE_IDENTITY_CLIENT_ID &&
    env.INFISICAL_MACHINE_IDENTITY_CLIENT_SECRET
  ) {
    headers["x-machine-identity-client-id"] = env.INFISICAL_MACHINE_IDENTITY_CLIENT_ID;
    headers["x-machine-identity-client-secret"] = env.INFISICAL_MACHINE_IDENTITY_CLIENT_SECRET;
    return headers;
  }

  throw new Error(
    "No Infisical machine identity configured. Set INFISICAL_GATEWAY_TOKEN or machine identity client credentials.",
  );
}

export async function callGateway<T>(path: string, payload: unknown): Promise<T> {
  ensureGatewayConfig();

  const response = await fetch(`${env.INFISICAL_GATEWAY_URL}${path}`, {
    method: "POST",
    headers: getGatewayAuthHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Infisical gateway request failed (${response.status}): ${text}`);
  }

  const body = (await response.json()) as GatewayResponse<T>;
  return body.data;
}
