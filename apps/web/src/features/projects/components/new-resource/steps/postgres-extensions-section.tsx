import { POSTGRES_EXTENSIONS, resolvePostgresImage } from "@otterdeploy/shared/postgres-extensions";
/**
 * Postgres extension picker for the create wizard. Shared by the version step
 * (default flow) so extensions are selectable without "Advanced setup". Toggles
 * write the `extensions` form field; the create path folds them into the
 * manifest (`databases[name].extensions`) and resolves the matching image.
 */
import { useStore } from "@tanstack/react-form";
import { toast } from "sonner";

import { Card, CardContent } from "@/shared/components/ui/card";
import { Switch } from "@/shared/components/ui/switch";

import { useFormContext } from "../form-context";
import { SectionHeader } from "../form-primitives";

export function PostgresExtensionsSection() {
  const form = useFormContext();
  const extensions = useStore(
    form.store,
    (s) => (s.values.extensions as string[] | undefined) ?? [],
  );

  const toggleExtension = (name: string, on: boolean) => {
    const next = on ? [...extensions, name] : extensions.filter((e) => e !== name);
    // Block image-incompatible combinations before they reach the manifest —
    // pgvector / PostGIS / TimescaleDB each pin a different image.
    const resolved = resolvePostgresImage(next, "postgres");
    if (!resolved.ok) {
      toast.error(
        `Can't combine these extensions — they need different images: ${resolved.conflict.join(", ")}`,
      );
      return;
    }
    form.setFieldValue("extensions", next);
  };

  return (
    <>
      <SectionHeader
        title="Extensions"
        sub="Enable extensions on the postgres instance — you can change these later"
      />
      <Card className="mt-2.5 rounded-md">
        <CardContent>
          {POSTGRES_EXTENSIONS.map((ext) => (
            <div
              key={ext.name}
              className="flex items-center gap-3 border-t py-2.5 first:border-t-0"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  {ext.label}
                  {!ext.contrib && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                      image swap
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground">{ext.description}</div>
              </div>
              <Switch
                size="sm"
                checked={extensions.includes(ext.name)}
                onCheckedChange={(next) => toggleExtension(ext.name, next)}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
