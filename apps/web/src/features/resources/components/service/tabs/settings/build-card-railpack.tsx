// Railpack build card: package-manager override, build command, static root,
// SPA toggle, and the monorepo task-runner knobs.
//
// The turbo fields only do anything when the repo root is a workspace and the
// service has a root directory inside it — turbo is a task RUNNER over a
// workspace the package manager defined, never the thing that defines one. The
// builder enforces that; the copy here says it so the setting isn't mistaken
// for "turn my repo into a monorepo".

import type { BuildRailpackConfig, BuildRunner } from "@otterdeploy/shared/build-config";

import { useForm, useSelector } from "@tanstack/react-form";

import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";

import { BuildSelect, useSaveBuild } from "./build-card-save";
import { BuildFieldRow, SaveRow, type ServiceBuildResource, trimToNull } from "./build-card-shared";

interface RailpackFormValues {
  packageManager: string;
  buildCommand: string;
  staticRoot: string;
  spa: boolean;
  buildRunner: BuildRunner;
  turboFilter: string;
  turboRemoteCache: boolean;
  turboPrune: boolean;
}

// Each row: [field name, label, hint, placeholder, disabled when the runner
// is "script"]. Table-driven so a new text knob is a row, not another copy of
// the same BuildFieldRow + Input block.
const RAILPACK_TEXT_FIELDS = [
  [
    "packageManager",
    "Package manager",
    "Override the repo's pin, e.g. bun@1.3.13 or pnpm@9.12.0.",
    "auto (repo's packageManager)",
    false,
  ],
  ["buildCommand", "Build command", "Overrides the detected build step.", "auto", false],
  [
    "staticRoot",
    "Static root",
    "Built-assets dir for static sites (default: dist).",
    "dist",
    false,
  ],
  [
    "turboFilter",
    "Turbo filter",
    "Overrides the derived --filter (the app's package name). Rarely needed.",
    "auto (package name)",
    true,
  ],
] as const;

// Each row: [field name, title, hint, disabled when the runner is "script"].
// Table-driven for the same reason RAILPACK_TEXT_FIELDS is: three hand-written
// <form.Field><ToggleRow/></form.Field> blocks differ only in their strings.
const RAILPACK_TOGGLES = [
  ["spa", "Single-page app", "Serve via Caddy with history fallback to index.html.", false],
  [
    "turboRemoteCache",
    "Turborepo Remote Cache",
    "Reads TURBO_TOKEN (and TURBO_TEAM / TURBO_API) from this service's variables and passes them to the build as secrets.",
    true,
  ],
  [
    "turboPrune",
    "Prune the workspace",
    "Build from a turbo-pruned copy: only the packages this app reaches get copied and installed. Skipped automatically when the repo keeps shared config at its root.",
    true,
  ],
] as const;

const RUNNER_OPTIONS = [
  ["auto", "Auto (use Turborepo when present)"],
  ["turbo", "Turborepo"],
  ["script", "Package script"],
] as const satisfies readonly (readonly [BuildRunner, string])[];

/** Preserve watchPatterns (not edited here); overwrite the rest. */
const toRailpackBuild = (
  config: BuildRailpackConfig,
  value: RailpackFormValues,
): BuildRailpackConfig => ({
  builder: "railpack",
  ...(config.watchPatterns ? { watchPatterns: config.watchPatterns } : {}),
  packageManager: trimToNull(value.packageManager),
  buildCommand: trimToNull(value.buildCommand),
  staticRoot: trimToNull(value.staticRoot),
  spa: value.spa ? true : null,
  buildRunner: value.buildRunner === "auto" ? null : value.buildRunner,
  turboFilter: trimToNull(value.turboFilter),
  turboRemoteCache: value.turboRemoteCache ? true : null,
  turboPrune: value.turboPrune ? true : null,
});

/** The saved config as form values. ONE definition, used both to seed the form
 *  and to diff against it: two copies would drift the moment a knob is added,
 *  and the form would quietly stop reporting itself dirty for that field. */
const formValuesFrom = (config: BuildRailpackConfig): RailpackFormValues => ({
  packageManager: config.packageManager ?? "",
  buildCommand: config.buildCommand ?? "",
  staticRoot: config.staticRoot ?? "",
  spa: config.spa ?? false,
  buildRunner: config.buildRunner ?? "auto",
  turboFilter: config.turboFilter ?? "",
  turboRemoteCache: config.turboRemoteCache ?? false,
  turboPrune: config.turboPrune ?? false,
});

/** Field-by-field comparison against the saved config. Expressed as a table so
 *  adding a knob doesn't grow one boolean expression past the complexity cap. */
const railpackDirty = (config: BuildRailpackConfig, values: RailpackFormValues): boolean => {
  const saved = formValuesFrom(config);
  const keys: (keyof RailpackFormValues)[] = [
    "packageManager",
    "buildCommand",
    "staticRoot",
    "spa",
    "buildRunner",
    "turboFilter",
    "turboRemoteCache",
    "turboPrune",
  ];
  return keys.some((key) => saved[key] !== values[key]);
};

/** A label + hint + control row with the card's switch layout. */
function ToggleRow({
  title,
  hint,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2.5">
      <div className="flex flex-col">
        <span className="text-[13px] font-medium">{title}</span>
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

export function RailpackBuildCard({
  resource,
  config,
}: {
  resource: ServiceBuildResource;
  config: BuildRailpackConfig;
}) {
  const save = useSaveBuild(resource);

  const form = useForm({
    defaultValues: formValuesFrom(config),
    onSubmit: ({ value }) => save.mutate(toRailpackBuild(config, value)),
  });
  const values = useSelector(form.store, (s) => s.values);

  return (
    <SettingsCard
      title="Build"
      description="Railpack reads these before building. Empty fields auto-detect from the repo. Saved changes apply on the next Deploy."
    >
      {RAILPACK_TEXT_FIELDS.map(([name, label, hint, placeholder, runnerScoped]) => (
        <BuildFieldRow key={name} label={label} hint={hint}>
          <form.Field name={name}>
            {(field) => (
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder={placeholder}
                className="h-8 font-mono text-[12.5px]"
                disabled={save.isPending || (runnerScoped && values.buildRunner === "script")}
              />
            )}
          </form.Field>
        </BuildFieldRow>
      ))}

      <BuildFieldRow
        label="Build runner"
        hint="For a service in a workspace subdirectory. Turborepo builds the app's internal package dependencies first; a package script builds only the app."
      >
        <form.Field name="buildRunner">
          {(field) => (
            <BuildSelect
              value={field.state.value}
              onChange={field.handleChange}
              options={RUNNER_OPTIONS}
              disabled={save.isPending}
            />
          )}
        </form.Field>
      </BuildFieldRow>

      {RAILPACK_TOGGLES.map(([name, title, hint, runnerScoped]) => (
        <form.Field key={name} name={name}>
          {(field) => (
            <ToggleRow
              title={title}
              hint={hint}
              checked={field.state.value}
              disabled={save.isPending || (runnerScoped && values.buildRunner === "script")}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
      ))}

      <SaveRow
        dirty={railpackDirty(config, values)}
        pending={save.isPending}
        onSave={() => void form.handleSubmit()}
      />
    </SettingsCard>
  );
}
