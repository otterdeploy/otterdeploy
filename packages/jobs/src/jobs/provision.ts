import * as z from "zod";

import { defineJob } from "../define";

/**
 * SSH-provision a host into the swarm (install Docker, join the mesh, join the
 * swarm). The REAL handler is wired in `apps/server` because it needs
 * `@otterdeploy/api`'s SSH + manager-socket access, which can't live in
 * `packages/jobs` (that would invert the dependency). The inline handler below
 * is a fallback that only logs — reaching it means no server process claimed
 * the queue. Design: docs/designs/server-onboarding.md
 *
 * Secrets (SSH password, mesh auth key, cloudflare token) travel as AES-GCM
 * ciphertext so the BullMQ payload in Redis never holds plaintext; the api-side
 * handler decrypts them.
 */
export const ProvisionServerPayload = z.object({
  serverId: z.string().min(1),
  organizationId: z.string().min(1),
  host: z.string().min(1),
  sshUser: z.string().min(1),
  sshPort: z.number().int(),
  role: z.enum(["manager", "worker"]),
  sshKeyId: z.string().nullable().optional(),
  buildServer: z.boolean().default(false),
  meshProvider: z.enum(["none", "tailscale", "netbird"]).default("none"),
  meshManagementUrl: z.string().nullable().optional(),
  passwordCiphertext: z.string().nullable().optional(),
  meshAuthKeyCiphertext: z.string().nullable().optional(),
  cloudflareTokenCiphertext: z.string().nullable().optional(),
});
export type ProvisionServerPayload = z.infer<typeof ProvisionServerPayload>;

export const provisionServerJob = defineJob({
  name: "server.provision",
  schema: ProvisionServerPayload,
  opts: {
    // No auto-retry: a failed provision is retried explicitly by the operator
    // (server.retryProvision) after they fix the cause. Keep terminal rows
    // around for visibility in the dashboard.
    attempts: 1,
    removeOnComplete: { age: 60 * 60 * 24 },
    removeOnFail: { age: 60 * 60 * 24 * 7 },
  },
  async handler(payload, { log }) {
    log.warn({
      provision: { event: "no-handler", serverId: payload.serverId },
      why: "server.provision reached the fallback handler — apps/server must wire the real one",
    });
    return { acknowledged: true };
  },
});
