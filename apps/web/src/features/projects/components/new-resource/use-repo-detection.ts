/**
 * Detection-driven wizard defaults — the wizard should answer its own
 * questions when `git.inspectRepo` already knows the answer:
 *
 *   - Vite/React/Vue repo → SPA routing preselected (no toggle to think about)
 *   - Next.js/Nuxt/Go/… → the framework's conventional port prefilled (no
 *     PORT env is injected at runtime, so the right value is a lookup)
 *
 * Auto-fill never clobbers a user edit: we only overwrite a value that is
 * still the pristine form default or one we auto-applied ourselves.
 */
import { useStore } from "@tanstack/react-form";
import { skipToken, useQuery } from "@tanstack/react-query";
import { frameworkDefaultPort, isSpaFramework } from "@otterdeploy/shared/framework";
import { useEffect, useRef } from "react";

import { orpc } from "@/shared/server/orpc";

import type { useWizardForm } from "./wizard-form";

import { useFormContext } from "./form-context";

type WizardForm = ReturnType<typeof useWizardForm>["form"];

interface Detection {
  framework: string | null;
  /** The framework's conventional listen port, when it has one. */
  defaultPort: number | null;
}

function useInspectQuery(repo: string, root: string): Detection {
  // Same query (and key) as the Builder step's DetectionBanner and the root
  // directory picker — react-query dedupes, so this adds no network cost.
  const inspect = useQuery({
    ...orpc.git.inspectRepo.queryOptions({
      input: repo ? { gitRepoId: repo, path: root || "" } : skipToken,
    }),
    staleTime: 5 * 60 * 1000,
  });
  const framework = inspect.data?.framework ?? null;
  return { framework, defaultPort: frameworkDefaultPort(framework) };
}

/** Step-view accessor (needs a mounted form context) — for detection hints. */
export function useRepoDetection(): Detection {
  const form = useFormContext();
  const repo = useStore(form.store, (s) => s.values.repo as string);
  const root = useStore(form.store, (s) => s.values.root as string);
  return useInspectQuery(repo, root);
}

/** Wizard-level effect: apply detection results onto the form once per
 *  (repo, root, framework). Mounted in the wizard body so it runs no matter
 *  which step the user is on when inspection resolves. */
export function useDetectionDefaults(form: WizardForm): void {
  const repo = useStore(form.store, (s) => s.values.repo);
  const root = useStore(form.store, (s) => s.values.root);
  const { framework, defaultPort } = useInspectQuery(repo, root);

  // Pristine defaults come from resourceDefaults; after we auto-apply, the
  // auto value becomes the new "untouched" baseline. Anything else is a user
  // edit and is left alone.
  const auto = useRef<{ key: string; port: number; spa: boolean }>({
    key: "",
    port: 3000,
    spa: true,
  });

  useEffect(() => {
    if (!framework) return;
    const key = `${repo}:${root}:${framework}`;
    if (auto.current.key === key) return;
    auto.current.key = key;

    if (defaultPort != null) {
      const ports = form.getFieldValue("ports");
      const only = ports.length === 1 ? ports[0] : undefined;
      if (only && only.port === auto.current.port && only.port !== defaultPort) {
        form.setFieldValue("ports", [{ ...only, port: defaultPort }]);
      }
      auto.current.port = defaultPort;
    }

    const spaTarget = isSpaFramework(framework);
    if (form.getFieldValue("spa") === auto.current.spa) {
      form.setFieldValue("spa", spaTarget);
    }
    auto.current.spa = spaTarget;
  }, [framework, defaultPort, repo, root, form]);
}
