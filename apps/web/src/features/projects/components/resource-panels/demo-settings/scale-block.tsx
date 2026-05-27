import { Input } from "@/shared/components/ui/input";

import { Field, PillButton, SettingsBlock, SubLabel, Toggle } from "./atoms";

export function ScaleBlock() {
  return (
    <SettingsBlock title="Scale">
      <div className="flex items-center justify-between">
        <div>
          <SubLabel>Autoscaling</SubLabel>
          <p className="mt-1 text-xs text-muted-foreground">
            Currently running <span className="text-foreground/80">1</span>{" "}
            replicas. When CPU % stays above 70% for 60s, replicas grow up
            to 8. They shrink back to 2 when below 30%.
          </p>
        </div>
        <Toggle on label="enabled" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field label="Min replicas">
          <Input className="h-8 font-mono" defaultValue="2" />
        </Field>
        <Field label="Max replicas">
          <Input className="h-8 font-mono" defaultValue="8" />
        </Field>
      </div>

      <SubLabel className="mt-4">Trigger metric</SubLabel>
      <div className="flex items-center gap-2">
        <PillButton active>CPU %</PillButton>
        <PillButton>Memory %</PillButton>
        <PillButton>Requests / sec</PillButton>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Field label="Scale up above (%)">
          <Input className="h-8 font-mono" defaultValue="70" />
        </Field>
        <Field label="Scale down below (%)">
          <Input className="h-8 font-mono" defaultValue="30" />
        </Field>
        <Field label="Cooldown (s)" hint="Pause between scale events.">
          <Input className="h-8 font-mono" defaultValue="120" />
        </Field>
      </div>
    </SettingsBlock>
  );
}
