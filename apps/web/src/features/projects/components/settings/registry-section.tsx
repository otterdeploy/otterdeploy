/**
 * Registry binding — pick which container_registry credential the
 * builder pushes built images to, and what image name (no tag) to
 * push under. Tags get appended by the builder: `<sha>` + `latest`.
 */

import { useLiveQuery } from "@tanstack/react-db";

import { registryCollection } from "@/features/registries/data/registries";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/shared/components/ui/native-select";

interface RegistrySectionProps {
  containerRegistryId: string | null;
  imageRepository: string;
  onContainerRegistryIdChange: (v: string | null) => void;
  onImageRepositoryChange: (v: string) => void;
}

export function RegistrySection(props: RegistrySectionProps) {
  const { data: registries } = useLiveQuery((q) => q.from({ r: registryCollection }));

  return (
    <section className="rounded-md border bg-card p-5">
      <header className="mb-3">
        <h2 className="text-[14px] font-semibold">Image target</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Where built images get pushed. The builder appends a SHA tag and{" "}
          <span className="font-mono">:latest</span> automatically.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bind-registry">Registry credential</Label>
          <NativeSelect
            id="bind-registry"
            value={props.containerRegistryId ?? ""}
            onChange={(e) => props.onContainerRegistryIdChange(e.target.value || null)}
            disabled={registries.length === 0}
          >
            <NativeSelectOption value="">
              {registries.length === 0 ? "No registries configured" : "Choose a registry"}
            </NativeSelectOption>
            {registries.map((r) => (
              <NativeSelectOption key={r.id} value={r.id}>
                {r.displayName} ({r.host})
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bind-image">Image repository</Label>
          <Input
            id="bind-image"
            value={props.imageRepository}
            onChange={(e) => props.onImageRepositoryChange(e.target.value)}
            placeholder="ghcr.io/acme/api"
            className="font-mono"
          />
          <p className="text-[11px] text-muted-foreground">
            Fully qualified, no tag. Must match the host of the chosen credential.
          </p>
        </div>
      </div>
    </section>
  );
}
