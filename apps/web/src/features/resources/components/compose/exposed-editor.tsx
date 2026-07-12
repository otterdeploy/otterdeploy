// "Exposed services" editor for a live compose stack — change which
// `service:port` pairs are published (and on what domain) without re-staging the
// manifest. Saves through `compose.setExposed`, which re-mints the Caddy routes.
import { useState } from "react";

import { Delete02Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { RESOURCE_COLLECTION_KEY } from "@/features/resources/data/resource";
import { orpc, queryClient } from "@/shared/server/orpc";

interface ServiceSummary {
  name: string;
  ports: number[];
}
interface Exposure {
  service: string;
  port: number;
  domain: string;
}
interface Row extends Exposure {
  id: string;
}

let seq = 0;
const newRow = (service = "", port = 0, domain = ""): Row => ({
  id: `ex-${seq++}`,
  service,
  port,
  domain,
});

/** Strip the local row id; drops rows with no service/port chosen. */
function toExposed(rows: Row[]): Exposure[] {
  return rows.flatMap((r) =>
    r.service && r.port > 0
      ? [{ service: r.service, port: r.port, domain: r.domain.trim() }]
      : [],
  );
}

export function ComposeExposedEditor({
  projectId,
  resourceId,
}: {
  projectId: string;
  resourceId: string;
}) {
  const view = useQuery(orpc.compose.get.queryOptions({ input: { projectId, resourceId } }));

  if (view.isLoading) {
    return <p className="text-[12px] text-muted-foreground">Loading…</p>;
  }
  if (view.isError || !view.data) {
    return (
      <p className="text-[12px] text-destructive">Couldn't load the stack's exposed services.</p>
    );
  }

  return (
    <ExposedForm
      projectId={projectId}
      resourceId={resourceId}
      services={view.data.services}
      initial={view.data.exposed}
    />
  );
}

function ExposedForm({
  projectId,
  resourceId,
  services,
  initial,
}: {
  projectId: string;
  resourceId: string;
  services: ServiceSummary[];
  initial: Exposure[];
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((e) => newRow(e.service, e.port, e.domain)),
  );

  const save = useMutation({
    ...orpc.compose.setExposed.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.compose.get.queryKey({
          input: { projectId, resourceId },
        }),
      });
      await queryClient.invalidateQueries({ queryKey: RESOURCE_COLLECTION_KEY });
      toast.success("Exposed services updated", {
        description: "Routes re-mint immediately.",
      });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to update exposures"),
  });

  const dirty = JSON.stringify(toExposed(rows)) !== JSON.stringify(initial);

  const setRow = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: string) => setRows((rs) => rs.filter((r) => r.id !== id));
  const addRow = () => {
    const first = services[0];
    setRows((rs) => [...rs, newRow(first?.name ?? "", first?.ports[0] ?? 0)]);
  };

  return (
    <div className="rounded-lg border border-border/60 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold">Exposed services</div>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Publish a <code className="font-mono">service:port</code> on a public domain. Leave the
            domain blank to auto-generate one.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7"
          disabled={save.isPending || services.length === 0}
          onClick={addRow}
        >
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
          Expose
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-[12px] text-muted-foreground">
          Nothing exposed — this stack is internal-only.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-1.5">
          {rows.map((row) => {
            const svc = services.find((s) => s.name === row.service);
            return (
              <div key={row.id} className="flex items-center gap-1.5">
                <select
                  aria-label="Service"
                  value={row.service}
                  disabled={save.isPending}
                  onChange={(e) => {
                    const next = services.find((s) => s.name === e.target.value);
                    setRow(row.id, {
                      service: e.target.value,
                      port: next?.ports.includes(row.port)
                        ? row.port
                        : (next?.ports[0] ?? row.port),
                    });
                  }}
                  className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 font-mono text-[12.5px]"
                >
                  {row.service === "" && <option value="">service…</option>}
                  {services.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">:</span>
                <Input
                  type="number"
                  value={row.port || ""}
                  onChange={(e) => setRow(row.id, { port: Number(e.target.value) || 0 })}
                  placeholder={svc?.ports[0] ? String(svc.ports[0]) : "port"}
                  className="h-8 w-20 font-mono text-[12.5px]"
                  disabled={save.isPending}
                />
                <Input
                  value={row.domain}
                  onChange={(e) => setRow(row.id, { domain: e.target.value })}
                  placeholder="auto domain"
                  className="h-8 flex-1 font-mono text-[12.5px]"
                  disabled={save.isPending}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  disabled={save.isPending}
                  onClick={() => removeRow(row.id)}
                  aria-label="Remove exposure"
                >
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ projectId, resourceId, exposed: toExposed(rows) })}
        >
          {save.isPending ? "Saving…" : "Save exposures"}
        </Button>
      </div>
    </div>
  );
}
