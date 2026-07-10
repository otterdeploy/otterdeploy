/**
 * Custom-certificate installation for the Caddy edge.
 *
 * Operator-uploaded certs live in the DB (chain in the clear, key AES-GCM
 * encrypted — see packages/db/src/schema/certificates.ts). Caddy can only
 * serve them from FILES, so on every reconcile we materialize each servable
 * cert under the host dir that is bind-mounted into the edge container at
 * `/etc/caddy` (`${OTTERDEPLOY_DATA_DIR}/caddy` in docker-compose.prod.yml):
 *
 *     host:      ${DATA_ROOT}/caddy/certs/<certId>/{cert.pem,key.pem}
 *     container: /etc/caddy/certs/<certId>/{cert.pem,key.pem}
 *
 * and the builder emits `tls <cert> <key>` (container paths) on every enabled
 * http route the cert covers. Re-writing on every reconcile makes the files
 * self-healing after a data-dir wipe.
 *
 * HONESTY RULE: a cert that could not be written to disk is excluded from
 * emission (its row is flipped to installState="error" with the reason), so a
 * broken cert can never fail the global Caddy load and take other routes
 * down. Deployments whose data dir isn't shared with the edge container (or
 * isn't writable at all — bare dev) therefore surface "install failed"
 * honestly instead of pretending the cert is live.
 */

import type { CustomCertificateId, OrganizationId, ProjectId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { customCertificate } from "@otterdeploy/db/schema/certificates";
import { project } from "@otterdeploy/db/schema/project";
import { DATA_ROOT } from "@otterdeploy/shared/paths";
import { eq, inArray, ne } from "drizzle-orm";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import type { ProxyRouteInput } from "./builder";

import { asStepLogger } from "../lib/logger";
import { certCoversDomain } from "../lib/x509";

/** Host-side dir the cert files are written to (inside the data folder). */
export const caddyCertsHostDir = (): string => `${DATA_ROOT}/caddy/certs`;

/** Where the same dir appears INSIDE the edge container (`/etc/caddy` mount).
 *  These are the paths the emitted `tls` directives must reference. */
export const CADDY_CERTS_CONTAINER_DIR = "/etc/caddy/certs";

/** A custom cert that may be emitted into the Caddyfile. Paths are the
 *  container-side paths (what Caddy reads). */
export interface ServableCustomCert {
  id: CustomCertificateId;
  organizationId: OrganizationId;
  hostname: string;
  subjectCN: string | null;
  sans: string[];
  certPath: string;
  keyPath: string;
}

interface ServableRow {
  id: CustomCertificateId;
  /** Plain string off the select — branded to OrganizationId in toServable
   *  (the schema column carries no $type brand). */
  organizationId: string;
  hostname: string;
  subject: string | null;
  sans: string[];
  certPem: string;
  keyCiphertext: string;
  createdAt: Date;
}

function toServable(
  row: Pick<ServableRow, "id" | "organizationId" | "hostname" | "subject" | "sans">,
): ServableCustomCert {
  return {
    id: row.id,
    organizationId: row.organizationId as OrganizationId,
    hostname: row.hostname,
    // subject column stores the one-line DN ("CN=x, O=y") — extract the CN.
    subjectCN: row.subject?.match(/(?:^|, )CN=([^,]+)/)?.[1] ?? null,
    sans: row.sans,
    certPath: `${CADDY_CERTS_CONTAINER_DIR}/${row.id}/cert.pem`,
    keyPath: `${CADDY_CERTS_CONTAINER_DIR}/${row.id}/key.pem`,
  };
}

async function listServableRows(): Promise<ServableRow[]> {
  return db
    .select({
      id: customCertificate.id,
      organizationId: customCertificate.organizationId,
      hostname: customCertificate.hostname,
      subject: customCertificate.subject,
      sans: customCertificate.sans,
      certPem: customCertificate.certPem,
      keyCiphertext: customCertificate.keyCiphertext,
      createdAt: customCertificate.createdAt,
    })
    .from(customCertificate)
    .where(ne(customCertificate.installState, "error"))
    .orderBy(customCertificate.createdAt);
}

/**
 * DB-only view of the servable certs (no file writes) — used by the read-only
 * per-project Caddyfile render so it shows the same `tls` lines reconcile
 * emits, without touching disk on every page view.
 */
export async function listServableCustomCerts(): Promise<ServableCustomCert[]> {
  const rows = await listServableRows();
  return rows.map(toServable);
}

/**
 * Write every servable cert's files for the edge container and return the set
 * that is actually on disk. Rows whose files could not be written are flipped
 * to installState="error" (with the reason) and EXCLUDED, so the emitted
 * Caddyfile never references a file Caddy can't read. Called from
 * `reconcile()`; the certificates router reads back the row state afterwards
 * to report an honest install outcome.
 */
export async function materializeCustomCerts(rlog?: RequestLogger): Promise<ServableCustomCert[]> {
  const log = asStepLogger(rlog);
  const rows = await listServableRows();
  if (rows.length === 0) return [];

  // Lazy import: decryptSecret pulls the env boundary; keep this module cheap
  // to import for the pure matching helpers below.
  const { decryptSecret } = await import("../lib/crypto");

  const servable: ServableCustomCert[] = [];
  for (const row of rows) {
    try {
      const key = await decryptSecret(row.keyCiphertext);
      const dir = join(caddyCertsHostDir(), row.id);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(join(dir, "cert.pem"), row.certPem, { mode: 0o600 });
      await writeFile(join(dir, "key.pem"), key, { mode: 0o600 });
      servable.push(toServable(row));
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      log.warn({
        caddy: { step: "materialize-cert", status: "failed", certId: row.id, detail: reason },
      });
      await db
        .update(customCertificate)
        .set({
          installState: "error",
          installError: `could not write certificate files for the edge: ${reason}`,
          updatedAt: new Date(),
        })
        .where(eq(customCertificate.id, row.id));
    }
  }
  return servable;
}

/** Remove a deleted cert's files. Guarded to inside DATA_ROOT and to a path
 *  ending in the cert id (same insurance as data-dir.ts); best-effort. */
export async function removeCustomCertFiles(id: CustomCertificateId): Promise<void> {
  const dir = resolve(join(caddyCertsHostDir(), id));
  const root = resolve(DATA_ROOT);
  if (!dir.startsWith(root + sep) || !dir.endsWith(id)) return;
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

/** projectId → organizationId for the given projects (custom certs are
 *  org-scoped; a cert must never be served on another org's domain). */
export async function mapProjectOrganizations(
  projectIds: ProjectId[],
): Promise<Map<string, OrganizationId>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({ id: project.id, organizationId: project.organizationId })
    .from(project)
    .where(inArray(project.id, projectIds));
  return new Map(rows.map((r) => [r.id as string, r.organizationId as OrganizationId]));
}

/**
 * Pure: pick the cert to serve for `domain` (or null). Exact `hostname` match
 * wins over a SAN/wildcard cover; ties resolve to the earliest row (the input
 * list is createdAt-ordered).
 */
export function matchCustomCert(
  certs: ServableCustomCert[],
  domain: string,
  organizationId: string | undefined,
): ServableCustomCert | null {
  if (!organizationId) return null;
  const target = domain.trim().toLowerCase();
  let covering: ServableCustomCert | null = null;
  for (const cert of certs) {
    if (cert.organizationId !== organizationId) continue;
    if (cert.hostname.toLowerCase() === target) return cert;
    if (
      covering === null &&
      certCoversDomain({ subjectCN: cert.subjectCN, sans: cert.sans }, target)
    ) {
      covering = cert;
    }
  }
  return covering;
}

/**
 * Pure: attach `customCert` (container cert/key paths) to every http route a
 * servable cert covers, scoped to the cert's organization. Returns new route
 * objects; untouched routes pass through as-is.
 */
export function applyCustomCertsToRoutes(
  routes: ProxyRouteInput[],
  certs: ServableCustomCert[],
  projectOrg: Map<string, string>,
): ProxyRouteInput[] {
  if (certs.length === 0) return routes;
  return routes.map((route) => {
    if (route.type !== "http") return route;
    const match = matchCustomCert(certs, route.domain, projectOrg.get(route.projectId));
    if (!match) return route;
    return { ...route, customCert: { certPath: match.certPath, keyPath: match.keyPath } };
  });
}
