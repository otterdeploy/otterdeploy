/**
 * Everything the wizard derives from a repo binding: service name, monorepo
 * root, builder, service type, port, SPA routing and `.env.example` keys.
 * Kept free of React and of the oRPC client so it runs under a plain form in
 * tests; `useSourceDefaults` (source-defaults.ts) wires it to the query cache.
 */

import { isSecretKey } from "@otterdeploy/shared/env-var-kind";
import { isSpaFramework } from "@otterdeploy/shared/framework";

import type { useFormContext } from "../form-context";

import {
  defaultBuilder,
  defaultPort,
  defaultServiceType,
  type RepoDetection,
} from "../build-defaults";
import { AUTO_WRITE } from "../form-context";
import { pickDefaultMonorepoApp } from "../frameworks";

type WizardForm = ReturnType<typeof useFormContext>;

/** The form surface the defaults read and write, nothing else. */
export type DefaultsForm = Pick<
  WizardForm,
  "getFieldValue" | "setFieldValue" | "getFieldMeta" | "setFieldMeta"
>;

/** What `git.inspectRepo` returns that the defaults read. */
export interface RepoInspection extends RepoDetection {
  fullName: string;
  monorepo: string | null;
  monorepoPackages: string[];
}

export interface SourceDefaultsDeps {
  inspect: (gitRepoId: string, path: string) => Promise<RepoInspection>;
  inspectEnv: (gitRepoId: string, path: string) => Promise<{ keys: string[] }>;
}

export interface SourceDefaults {
  /** A repo was bound, or the step mounted onto an existing binding. */
  onRepoBound: (gitRepoId: string) => Promise<void>;
  /** The operator browsed to a different folder: re-detect there. */
  onRootPicked: (root: string) => Promise<void>;
  /** The operator chose a service type: detection stops moving it. */
  pinKind: () => void;
  /** The operator chose a builder: detection stops moving it, and the port
   *  default follows the build that will now run (EXPOSE vs framework). */
  onBuilderPicked: (builderId: string) => Promise<void>;
  /** "Change repo". Drop the binding and everything derived from it. */
  clearBinding: () => void;
}

/** Repo full_name → a sane default service name (DNS-label-ish). */
export function deriveServiceName(fullName: string): string {
  const last = fullName.split("/").pop() ?? fullName;
  return last
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

/** Has the operator edited this field themselves? */
function edited(
  form: DefaultsForm,
  field: "name" | "root" | "ports" | "spa" | "variables" | "builderId",
): boolean {
  return form.getFieldMeta(field)?.isDirty === true;
}

export function createSourceDefaults(
  form: DefaultsForm,
  deps: SourceDefaultsDeps,
  /** Survives re-renders (a `useRef` in the hook): the operator chose a type. */
  kindPinned: { current: boolean },
): SourceDefaults {
  const { inspect, inspectEnv } = deps;

  /**
   * Pick the builder: the root directory's Dockerfile when there is one,
   * railpack otherwise (build-defaults.ts). Runs before the service type and
   * the port, which both follow from it. Stops once the operator picks one.
   */
  const applyBuilder = (detection: RepoDetection): void => {
    if (edited(form, "builderId")) return;
    const next = defaultBuilder(detection);
    if (form.getFieldValue("builderId") !== next) {
      form.setFieldValue("builderId", next, AUTO_WRITE);
    }
  };

  /**
   * Pre-select the service type from the builder decision and the detected
   * framework: a repo with a Dockerfile → "Web app" (a static site always
   * builds with railpack, which would ignore the Dockerfile); otherwise an
   * SPA/static framework (Vite, Astro, …) → "Static site", a server framework
   * → "Web app". Only ever moves between those two. `defaultServiceType`
   * answers "app" or "static" and nothing else, so letting it near a worker,
   * scheduled job or one-off would overwrite a choice the operator made on
   * the Kind step (and put the Networking step back into the flow).
   */
  const applyKind = (detection: RepoDetection): void => {
    if (kindPinned.current) return;
    const kindId = form.getFieldValue("kindId");
    if (kindId !== "app" && kindId !== "static") return;
    if (!detection.framework && !detection.dockerfile) return;
    const desired = defaultServiceType(detection);
    if (desired !== kindId) form.setFieldValue("kindId", desired, AUTO_WRITE);
  };

  /** The prefilled port for the build that will run. A single untouched row is
   *  the only one that's ours to move: a second row means the operator built a
   *  mapping, and there is no "the" port. */
  const applyPort = (detection: RepoDetection): void => {
    const next = defaultPort(form.getFieldValue("builderId"), detection);
    if (!next) return;
    const ports = form.getFieldValue("ports");
    if (ports.length === 1 && ports[0].port !== next.port && !edited(form, "ports")) {
      form.setFieldValue("ports", [{ ...ports[0], port: next.port }], AUTO_WRITE);
    }
  };

  /**
   * Prefill the runtime answers the detection already knows:
   *
   *   - the listen port, nothing injects `PORT` for a git-built service, so
   *     the correct value is a lookup, not a guess: the Dockerfile's EXPOSE
   *     when it builds the image, else the framework's conventional port
   *   - SPA routing for a Vite/React/Vue build, so the Networking step
   *     opens with the toggle already right
   *
   * Both stop the moment the operator touches the field. That question used
   * to need a ref holding the last value this wrote, compared against the
   * live one; `AUTO_WRITE` leaves the field pristine, so `isDirty` answers
   * it outright.
   */
  const applyRuntime = (detection: RepoDetection): void => {
    applyPort(detection);
    const { framework } = detection;
    if (!framework) return;
    const spa = isSpaFramework(framework);
    if (form.getFieldValue("spa") !== spa && !edited(form, "spa")) {
      form.setFieldValue("spa", spa, AUTO_WRITE);
    }
  };

  /**
   * Seed the Variables step from the repo's `.env.example`, keys only, values
   * blank, credential-looking keys locked.
   *
   * `isDirty` is the whole guard. The previous version lived in the Variables
   * step behind a `useRef` that meant "already prefilled", but the step only
   * mounts while it's the current step, so the ref died on every Continue and
   * came back false: clear the list, step away, step back, and the keys were
   * refilled underneath you. Written with `AUTO_WRITE` the rows stay pristine,
   * so any human edit (typing a value, adding a row, emptying the list)
   * latches this off for good, across remounts and re-binds alike.
   */
  const applyVariables = async (gitRepoId: string, path: string): Promise<void> => {
    if (edited(form, "variables")) return;
    const { keys } = await inspectEnv(gitRepoId, path);
    if (keys.length === 0) return;
    form.setFieldValue(
      "variables",
      keys.map((k) => ({ key: k, value: "", secret: isSecretKey(k) })),
      AUTO_WRITE,
    );
  };

  /** Builder first: the service type and the port both follow from it. */
  const applyDetection = async (gitRepoId: string, path: string): Promise<void> => {
    const { framework, dockerfile } = await inspect(gitRepoId, path);
    const detection: RepoDetection = { framework, dockerfile };
    applyBuilder(detection);
    applyKind(detection);
    applyRuntime(detection);
    await applyVariables(gitRepoId, path);
  };

  const onRepoBound = async (gitRepoId: string): Promise<void> => {
    if (!gitRepoId) return;
    // One probe at the repo root: it carries fullName, the root framework
    // and the workspace layout. Pinning path:"" is what keeps this a
    // straight line instead of a query keyed on the value it produces.
    const layout = await inspect(gitRepoId, "");

    // Name the service after the repo. `repoFullName` is set by both bind
    // paths; the probe covers a binding seeded from the project.
    if (!edited(form, "name")) {
      const derived = deriveServiceName(form.getFieldValue("repoFullName") || layout.fullName);
      if (derived) form.setFieldValue("name", derived, AUTO_WRITE);
    }

    // Monorepo: the deployable app almost never sits at the repo root, so
    // point the root at the best-guess `apps/*` package and detect there.
    if (layout.monorepo && !edited(form, "root") && !form.getFieldValue("root")) {
      const app = pickDefaultMonorepoApp(layout.monorepoPackages);
      if (app) form.setFieldValue("root", app, AUTO_WRITE);
    }

    // Detection reads the root the block above may have just moved.
    await applyDetection(gitRepoId, form.getFieldValue("root"));
  };

  const onRootPicked = async (root: string): Promise<void> => {
    const gitRepoId = form.getFieldValue("repo");
    if (!gitRepoId) return;
    // A different folder can be a different framework or carry its own
    // Dockerfile. Builder, port, SPA and the `.env.example` are as
    // root-dependent as the service type is.
    await applyDetection(gitRepoId, root);
  };

  const pinKind = (): void => {
    kindPinned.current = true;
  };

  const onBuilderPicked = async (builderId: string): Promise<void> => {
    // A plain write: it marks the field dirty, which stops `applyBuilder`.
    form.setFieldValue("builderId", builderId);
    const gitRepoId = form.getFieldValue("repo");
    if (!gitRepoId) return;
    const { framework, dockerfile } = await inspect(gitRepoId, form.getFieldValue("root"));
    applyPort({ framework, dockerfile });
  };

  const clearBinding = (): void => {
    const kindId = form.getFieldValue("kindId");
    // Clearing `repo` re-renders BindingSummary as the picker. The handler
    // above no-ops on an empty id, so this doesn't need to suppress it.
    form.setFieldValue("repo", "");
    form.setFieldValue("repoFullName", "", AUTO_WRITE);
    // Empty branch re-seeds from the new repo's real default. Forcing
    // "main" here would mask a master/develop default.
    form.setFieldValue("branch", "", AUTO_WRITE);
    form.setFieldValue("root", "", AUTO_WRITE);
    form.setFieldValue("name", kindId, AUTO_WRITE);
    form.setFieldValue("builderId", "railpack", AUTO_WRITE);
    // Hand the next binding a clean slate: without this, defaults the
    // operator overrode for the old repo would still count as "edited".
    for (const field of ["name", "root", "builderId"] as const) {
      form.setFieldMeta(field, (meta) => ({ ...meta, isTouched: false, isDirty: false }));
    }
    kindPinned.current = false;
  };

  return { onRepoBound, onRootPicked, pinKind, onBuilderPicked, clearBinding };
}
