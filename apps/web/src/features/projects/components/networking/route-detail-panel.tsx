/**
 * The expanded body of a route row: the TLS certificate the edge is serving,
 * and the way in to that route's access controls.
 *
 * Certificates and Access used to be sibling tabs that re-listed every domain,
 * so answering "is this cert healthy and who can reach it?" meant three
 * navigations and a mental join on the hostname. Both belong to a route, so
 * they hang off the route — but only as far as reading: the access editor is a
 * dialog, because inlining four editable sections made the row taller than the
 * table it lives in.
 */

import { RouteAccessButton } from "@/features/projects/components/networking/route-access-dialog";
import { cn } from "@/shared/lib/utils";
import { Skeleton } from "@/shared/components/ui/skeleton";

import type { RouteCertificate } from "./certificate-status";

import { CERT_STATUS, certExpiryLabel } from "./certificate-status";

/** One key/value line. The value track is `min-w-0` inside a `minmax(0,1fr)`
 *  grid column — plain `grid-cols-2` resolves to `minmax(auto,1fr)`, which lets
 *  a long serial or fingerprint push its track wider and overlap the next
 *  column instead of wrapping. */
function Fact({ k, v, wide }: { k: string; v: string; wide?: boolean }) {
  return (
    <div className={cn("flex min-w-0 gap-3", wide && "sm:col-span-2")}>
      <span className="w-20 shrink-0 text-muted-foreground">{k}</span>
      <span className="min-w-0 break-all text-foreground/90">{v}</span>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-mono text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

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
        <Label>TLS certificate</Label>
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (!cert) {
    return (
      <div className="flex flex-col gap-2">
        <Label>TLS certificate</Label>
        {/* No probe result is not the same as "no certificate" — say which. */}
        <p className="text-[12.5px] text-muted-foreground">
          Not probed yet. Caddy issues a certificate the first time the domain is
          served.
        </p>
      </div>
    );
  }

  const status = CERT_STATUS[cert.status];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <Label>TLS certificate</Label>
        <span className={cn("inline-flex items-center gap-1.5 text-[12px]", status.text)}>
          <span className={cn("size-1.5 rounded-full", status.dot)} />
          {status.label}
        </span>
      </div>
      {cert.error ? (
        <p className="font-mono text-[12px] break-all text-destructive">{cert.error}</p>
      ) : (
        <div className="grid grid-cols-1 gap-x-8 gap-y-1 font-mono text-[12px] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Fact k="issuer" v={cert.issuer ?? "—"} />
          <Fact k="expires" v={certExpiryLabel(cert)} />
          <Fact k="subject" v={cert.subject ?? "—"} />
          <Fact k="valid from" v={cert.notBefore ? new Date(cert.notBefore).toLocaleString() : "—"} />
          <Fact k="self-signed" v={cert.selfSigned ? "yes" : "no"} />
          <Fact k="serial" v={cert.serial ?? "—"} />
          {/* Full-width: these are long single tokens, and a half-width track
              makes them wrap into a ragged block next to a short neighbour. */}
          <Fact k="fingerprint" v={cert.fingerprint ?? "—"} wide />
          <Fact k="SANs" v={cert.sans.length ? cert.sans.join(", ") : "—"} wide />
        </div>
      )}
    </div>
  );
}

export function RouteDetailPanel({
  routeId,
  domain,
  isHttp,
  isProtected,
  cert,
  certsLoading,
}: {
  routeId: string;
  domain: string;
  isHttp: boolean;
  isProtected: boolean;
  cert: RouteCertificate | undefined;
  certsLoading: boolean;
}) {
  // Layer-4 routes (exposed databases) pass TCP straight through: no edge
  // certificate, no auth wall. Say so instead of rendering two empty blocks.
  if (!isHttp) {
    return (
      <div className="px-6 py-3 text-[12.5px] text-muted-foreground">
        Layer-4 (TCP) route — passed straight through to the upstream, so it
        carries no edge certificate and no access wall.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-4 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
      <div className="min-w-0 flex-1">
        <CertificateBlock cert={cert} loading={certsLoading} />
      </div>
      <div className="flex shrink-0 flex-col items-start gap-2">
        <Label>Access</Label>
        <p className="text-[12.5px] text-muted-foreground">
          {isProtected ? "Protected — visitors must sign in." : "Public — anyone with the URL."}
        </p>
        <RouteAccessButton routeId={routeId} domain={domain} isProtected={isProtected} />
      </div>
    </div>
  );
}
