import { useRef } from "react";

import { isSecretKey } from "@otterdeploy/shared/env-var-kind";
import { frameworkDefaultPort, isSpaFramework } from "@otterdeploy/shared/framework";
import { useQueryClient } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

import type { useFormContext } from "../form-context";

import { AUTO_WRITE } from "../form-context";
import { frameworkDefaultServiceType, pickDefaultMonorepoApp } from "../frameworks";
import { deriveServiceName } from "./source-pickers";

type WizardForm = ReturnType<typeof useFormContext>;

const INSPECT_STALE_MS = 5 * 60 * 1000;

/** Has the operator edited this field themselves? */
function edited(form: WizardForm, field: "name" | "root" | "ports" | "spa" | "variables"): boolean {
  return form.getFieldMeta(field)?.isDirty === true;
}

export interface SourceDefaults {
  /** A repo was bound, or the step mounted onto an existing binding. */
  onRepoBound: (gitRepoId: string) => Promise<void>;
  /** The operator browsed to a different folder: re-detect there. */
  onRootPicked: (root: string) => Promise<void>;
  /** The operator chose a service type: detection stops moving it. */
  pinKind: () => void;
  /** "Change repo". Drop the binding and everything derived from it. */
  clearBinding: () => void;
}

export function useSourceDefaults(form: WizardForm): SourceDefaults {
  const queryClient = useQueryClient();
  const kindPinned = useRef(false);

  // Same query key the RepoCheck / framework badge / root picker use, so
  // this reads their cache rather than adding a request.
  const inspect = (gitRepoId: string, path: string) =>
    queryClient.fetchQuery({
      ...orpc.git.inspectRepo.queryOptions({ input: { gitRepoId, path } }),
      staleTime: INSPECT_STALE_MS,
    });

  // Same key + staleTime the Variables step's own `useQuery` uses (it still
  // needs the response for the committed-env warning and the "pre-filled N
  // keys" note), so this warms that cache instead of adding a request.
  const inspectEnv = (gitRepoId: string, path: string) =>
    queryClient.fetchQuery({
      ...orpc.git.inspectEnv.queryOptions({ input: { gitRepoId, path } }),
      staleTime: INSPECT_STALE_MS,
    });

  /**
   * Pre-select the service type from the detected framework: an SPA/static
   * framework (Vite, Astro, …) → "Static site", a server framework → "Web
   * app". Only ever moves between those two. `frameworkDefaultServiceType`
   * answers "app" or "static" and nothing else, so letting it near a worker,
   * scheduled job or one-off would overwrite a choice the operator made on
   * the Kind step (and put the Networking step back into the flow).
   */
  const applyKind = async (gitRepoId: string, path: string): Promise<void> => {
    if (kindPinned.current) return;
    const kindId = form.getFieldValue("kindId");
    if (kindId !== "app" && kindId !== "static") return;
    const { framework } = await inspect(gitRepoId, path);
    if (!framework) return;
    const desired = frameworkDefaultServiceType(framework);
    if (desired !== kindId) form.setFieldValue("kindId", desired, AUTO_WRITE);
  };

  /**
   * Prefill the runtime answers the detected framework already knows:
   *
   *   - the conventional listen port, nothing injects `PORT` for a
   *     git-built service, so the correct value is a lookup, not a guess
   *   - SPA routing for a Vite/React/Vue build, so the Networking step
   *     opens with the toggle already right
   *
   * Both stop the moment the operator touches the field. That question used
   * to need a ref holding the last value this wrote, compared against the
   * live one; `AUTO_WRITE` leaves the field pristine, so `isDirty` answers
   * it outright.
   */
  const applyRuntime = async (gitRepoId: string, path: string): Promise<void> => {
    const { framework } = await inspect(gitRepoId, path);
    if (!framework) return;

    const port = frameworkDefaultPort(framework);
    const ports = form.getFieldValue("ports");
    // A single untouched row is the only one that's ours to move: a second
    // row means the operator built a mapping, and there is no "the" port.
    if (port != null && ports.length === 1 && ports[0].port !== port && !edited(form, "ports")) {
      form.setFieldValue("ports", [{ ...ports[0], port }], AUTO_WRITE);
    }

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
    const detectRoot = form.getFieldValue("root");
    await applyKind(gitRepoId, detectRoot);
    await applyRuntime(gitRepoId, detectRoot);
    await applyVariables(gitRepoId, detectRoot);
  };

  const onRootPicked = async (root: string): Promise<void> => {
    const gitRepoId = form.getFieldValue("repo");
    if (!gitRepoId) return;
    // A different folder can be a different framework. Port, SPA and the
    // `.env.example` are as root-dependent as the service type is.
    await applyKind(gitRepoId, root);
    await applyRuntime(gitRepoId, root);
    await applyVariables(gitRepoId, root);
  };

  const pinKind = (): void => {
    kindPinned.current = true;
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
    // Hand the next binding a clean slate: without this, defaults the
    // operator overrode for the old repo would still count as "edited".
    for (const field of ["name", "root"] as const) {
      form.setFieldMeta(field, (meta) => ({ ...meta, isTouched: false, isDirty: false }));
    }
    kindPinned.current = false;
  };

  return { onRepoBound, onRootPicked, pinKind, clearBinding };
}
