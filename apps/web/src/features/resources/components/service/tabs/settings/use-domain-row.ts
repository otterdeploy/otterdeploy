/**
 * Every mutation a single domain row can fire. Recheck, set-primary,
 * update, remove, and the Cloudflare auto-configure. Plus the toasts they
 * report through.
 *
 * Split out of ./domain-row so that component stays about layout: the row
 * renders five actions, and five `useMutation` blocks inline were most of
 * the file. Auto-configure chains into recheck on success, because records
 * that exist but were never re-checked look identical to records that were
 * never written.
 */

import type { ProjectId, ProxyRouteId, ResourceId } from "@otterdeploy/shared/id";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc } from "@/shared/server/orpc";

export interface DomainRowActionsApi {
  recheck: { run: () => void; pending: boolean };
  setPrimary: { run: () => void };
  remove: { run: () => void };
  update: { run: (value: { domain: string; port: number }) => void; pending: boolean };
  autoConfigure: { run: () => void; pending: boolean };
  /** Any write in flight, the row disables its actions on this. */
  busy: boolean;
}

export function useDomainRow({
  input,
  routeId,
  domain,
  onSettled,
  onUpdated,
}: {
  input: { projectId: ProjectId; resourceId: ResourceId };
  routeId: string;
  /** Current hostname: only used to word the toasts. */
  domain: string;
  onSettled: () => Promise<void>;
  /** Called after a successful rename so the row can leave edit mode. */
  onUpdated: () => void;
}): DomainRowActionsApi {
  const route = { ...input, routeId: routeId as ProxyRouteId };

  const recheck = useMutation({
    ...orpc.service.domains.recheck.mutationOptions(),
    onSuccess: (res) => {
      if (!res.ownershipVerified) {
        toast.warning(`TXT ownership proof for ${res.domain} was not found yet`);
      } else if (res.dnsState === "pointed") {
        toast.success(`${res.domain} points here. Certificate will issue`);
      } else if (res.dnsState === "proxied") {
        toast.success(`${res.domain} is proxied via Cloudflare`);
      } else {
        toast.warning(`${res.domain} isn't pointed here yet`);
      }
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "DNS check failed"),
    onSettled,
  });

  const autoConfigure = useMutation({
    ...orpc.service.domains.autoConfigureDns.mutationOptions(),
    onSuccess: () => {
      toast.success(`DNS records created for ${domain}`);
      // Records exist now, so the ownership check can actually pass. Run it
      // rather than making the operator find Recheck themselves.
      recheck.mutate(route);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Couldn't configure DNS automatically"),
  });

  const setPrimary = useMutation({
    ...orpc.service.domains.setPrimary.mutationOptions(),
    onSuccess: () => toast.success(`${domain} is now the primary domain`),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to set primary"),
    onSettled,
  });

  const remove = useMutation({
    ...orpc.service.domains.remove.mutationOptions(),
    onSuccess: () => toast.success(`Removed ${domain}`),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to remove domain"),
    onSettled,
  });

  const update = useMutation({
    ...orpc.service.domains.update.mutationOptions(),
    onSuccess: () => {
      onUpdated();
      toast.success("Domain updated");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to update domain"),
    onSettled,
  });

  return {
    recheck: { run: () => recheck.mutate(route), pending: recheck.isPending },
    setPrimary: { run: () => setPrimary.mutate(route) },
    remove: { run: () => remove.mutate(route) },
    update: {
      run: ({ domain: next, port }) => update.mutate({ ...route, domain: next, port }),
      pending: update.isPending,
    },
    autoConfigure: { run: () => autoConfigure.mutate(route), pending: autoConfigure.isPending },
    busy: recheck.isPending || setPrimary.isPending || remove.isPending || update.isPending,
  };
}
