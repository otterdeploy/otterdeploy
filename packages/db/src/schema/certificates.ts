import type { CustomCertificateId, TrustedCaId, UserId } from "@otterdeploy/shared/id";

// TLS certificate management — two org-scoped inventories:
//
//   - custom_certificate: operator-uploaded PEM cert (chain) + private key for
//     a hostname Caddy serves. The chain is stored in the clear (certificates
//     are public material); the private key is stored ONLY as AES-GCM
//     ciphertext (`keyCiphertext`, via packages/api/src/lib/crypto — the same
//     treatment as registry passwords and SSH private keys) and never leaves
//     the server. Metadata columns (issuer/subject/SANs/expiry/fingerprint)
//     are extracted server-side at upload from the leaf certificate so lists
//     never need to re-parse the PEM.
//
//     Install lifecycle (`installState`): the reconciler materializes the
//     cert+key as files under the Caddy config mount and emits a
//     `tls <cert> <key>` directive on every matching http route. "pending" =
//     stored, not yet confirmed live at the edge; "installed" = a reconcile
//     that included this cert loaded successfully; "error" = installation
//     failed (`installError` carries the honest reason) — error rows are
//     EXCLUDED from reconcile so a broken cert can never take the edge down.
//
//   - trusted_ca: uploaded CA certificates. Inventory only today — the
//     generated edge config proxies upstreams over plain HTTP on the internal
//     network, so nothing consumes a CA pool automatically; rows exist for
//     download/reference (e.g. from custom Caddy config).
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";

export const customCertificateInstallStateEnum = pgEnum("custom_certificate_install_state", [
  "pending",
  "installed",
  "error",
]);

export const customCertificate = pgTable(
  "custom_certificate",
  {
    id: text("id")
      .primaryKey()
      .$type<CustomCertificateId>()
      .$defaultFn(() => createId(ID_PREFIX.customCertificate)),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** The hostname this cert is intended for (must be covered by the cert's
     *  CN/SANs — validated at upload). Unique per org so two custom certs
     *  never compete for the same site block. */
    hostname: text("hostname").notNull(),
    /** Full PEM chain as uploaded (leaf first). Public material — stored in
     *  the clear so it can be re-emitted to disk on every reconcile. */
    certPem: text("cert_pem").notNull(),
    /** AES-GCM ciphertext of the PEM private key (lib/crypto.encryptSecret).
     *  Decrypted only to materialize the key file for Caddy; never returned
     *  by any contract output. */
    keyCiphertext: text("key_ciphertext").notNull(),
    // ── extracted leaf metadata (parsed once at upload) ──
    issuer: text("issuer"),
    subject: text("subject"),
    serial: text("serial"),
    sans: jsonb("sans").$type<string[]>().notNull().default([]),
    notBefore: timestamp("not_before").notNull(),
    notAfter: timestamp("not_after").notNull(),
    /** SHA-256 fingerprint of the leaf ("AA:BB:…") — same format as the live
     *  edge probe's `fingerprint256`, so "is this cert actually being served?"
     *  is a string comparison against ground truth. */
    fingerprint256: text("fingerprint256").notNull(),
    /** Human key description, e.g. "RSA 2048" / "ECDSA P-256". */
    keyAlg: text("key_alg"),
    // ── install lifecycle (see header comment) ──
    installState: customCertificateInstallStateEnum("install_state").notNull().default("pending"),
    installError: text("install_error"),
    /** Who uploaded/last replaced the material. Null for API-key actors or
     *  after the user is deleted. */
    uploadedByUserId: text("uploaded_by_user_id")
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (t) => [
    index("custom_certificate_organization_id_idx").on(t.organizationId),
    uniqueIndex("custom_certificate_org_hostname_unique").on(t.organizationId, t.hostname),
  ],
);

export const trustedCa = pgTable(
  "trusted_ca",
  {
    id: text("id")
      .primaryKey()
      .$type<TrustedCaId>()
      .$defaultFn(() => createId(ID_PREFIX.trustedCa)),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Operator-visible label, e.g. "internal-issuing-ca". */
    name: text("name").notNull(),
    /** The CA certificate PEM. Public material (no private key is ever
     *  accepted here) — returned by the contract for view/download. */
    pem: text("pem").notNull(),
    subject: text("subject"),
    /** SHA-256 fingerprint ("AA:BB:…"). Unique per org (dedupes re-uploads). */
    fingerprint256: text("fingerprint256").notNull(),
    notAfter: timestamp("not_after").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (t) => [
    index("trusted_ca_organization_id_idx").on(t.organizationId),
    uniqueIndex("trusted_ca_org_fingerprint_unique").on(t.organizationId, t.fingerprint256),
  ],
);
