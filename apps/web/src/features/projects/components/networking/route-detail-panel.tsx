/**
 * The expanded body of a route row: everything that used to live in the
 * Networking sub-tabs, shown against the route it actually belongs to.
 *
 * TLS/certificates and Access were separate tabs listing the same routes over
 * again, which meant answering "is this domain's cert healthy and who can
 * reach it?" took three navigations and a mental join on the hostname. Both
 * are attributes of a route, so they live on the route.
 */

import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { RouteAccessControls } from "@/features/projects/components/networking/route-access-controls";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";

import type { RouteCertificate } from "./certificate-status";

import { CERT_STATUS, certExpiryLabel } from "./certificate-status";

function Field({ k, v, wide }: { k: string; v: string; wide?: boolean }) {
  return (
    <div className={cn("flex min-w-0 gap-2", wide && "sm:col-span-2")}>
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className="min-w-0 break-all text-foreground/90">{v}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-mono text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

/** Live TLS facts for one domain, probed at the edge. */
function CertificateBlock({
  cert,
  loading,
}: {
  cert: RouteCertificate | undefined;
  loading: boolean;
}) {
  if (loading && !cert) {
    return (
      <div className="flex flex-col gap-2">
        <SectionTitle>TLS certificate</SectionTitle>
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (!cert) {
    return (
      <div className="flex flex-col gap-2">
        <SectionTitle>TLS certificate</SectionTitle>
        {/* Honest empty state: no probe result is not the same as "no cert". */}
        <p className="text-[12.5px] text-muted-foreground">
          No certificate has been probed for this domain yet. Caddy issues one
          the first time the domain is served.
        </p>
      </div>
    );
  }

  const status = CERT_STATUS[cert.status];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <SectionTitle>TLS certificate</SectionTitle>
        <span className={cn("inline-flex items-center gap-1.5 text-[12px]", status.text)}>
          <span className={cn("size-1.5 rounded-full", status.dot)} />
          {status.label}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-x-10 gap-y-1 font-mono text-[12px] sm:grid-cols-2">
        {cert.error ? (
          <Field k="error" v={cert.error} wide />
        ) : (
          <>
            <Field k="issuer" v={cert.issuer ?? "—"} />
            <Field k="expires" v={certExpiryLabel(cert)} />
            <Field k="subject" v={cert.subject ?? "—"} />
            <Field
              k="valid from"
              v={cert.notBefore ? new Date(cert.notBefore).toLocaleString() : "—"}
            />
            <Field k="self-signed" v={cert.selfSigned ? "yes" : "no"} />
            <Field k="serial" v={cert.serial ?? "—"} />
            <Field k="fingerprint" v={cert.fingerprint ?? "—"} wide />
            <Field k="SANs" v={cert.sans.length ? cert.sans.join(", ") : "—"} wide />
          </>
        )}
      </div>
    </div>
  );
}

export function RouteDetailPanel({
  routeId,
  isHttp,
  cert,
  certsLoading,
}: {
  routeId: string;
  isHttp: boolean;
  cert: RouteCertificate | undefined;
  certsLoading: boolean;
}) {
  // Layer-4 routes (exposed databases) terminate TCP, not TLS-with-a-cert, and
  // can't carry an auth wall — so neither block applies. Say so rather than
  // rendering two empty sections.
  if (!isHttp) {
    return (
      <div className="flex items-center gap-2 px-6 py-4 text-[12.5px] text-muted-foreground">
        <HugeiconsIcon
          icon={CheckmarkCircle02Icon}
          strokeWidth={1.6}
          className="size-4 shrink-0"
        />
        This is a layer-4 (TCP) route. It is passed straight through to the
        upstream, so it carries no edge certificate and no access wall.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 px-6 py-4 lg:grid-cols-2 lg:gap-10">
      <CertificateBlock cert={cert} loading={certsLoading} />
      <div className="flex flex-col gap-2">
        <SectionTitle>Access</SectionTitle>
        <RouteAccessControls routeId={routeId} />
      </div>
    </div>
  );
}
