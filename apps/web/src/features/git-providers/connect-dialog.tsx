/**
 * Connect-a-git-provider dialog.
 *
 * Single primary action: "Connect GitHub". It always Does The Right Thing:
 *
 *   - If the org already has a GitHub App configured (a `git_provider`
 *     row with credentials), `startConnect` returns a fresh install URL
 *     and we redirect to it.
 *
 *   - If not, `startConnect` returns NOT_CONFIGURED — we fall through to
 *     the manifest flow: call `startManifest`, get back a form action +
 *     manifest JSON, build a hidden form, auto-submit it. The browser
 *     leaves our origin and lands on GitHub's app-creation page with
 *     the manifest pre-filled; on approval, GitHub redirects back to
 *     `/api/integrations/github/manifest/callback` which persists the
 *     creds and forwards to the install URL.
 *
 * No env vars at any step — matches Coolify/Dokploy.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { GitBranchIcon } from "@hugeicons/core-free-icons";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { orpc } from "@/shared/server/orpc";

import { PROVIDER_LABEL, PROVIDER_SEARCH, type ProviderKind } from "./shared";

interface ConnectDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function ConnectDialog({ open, onOpenChange }: ConnectDialogProps) {
  const startManifest = useMutation({
    ...orpc.git.startManifest.mutationOptions(),
    onSuccess: (res) => {
      // Build a hidden form and POST it. Cross-origin form submission to
      // github.com is fine — manifest field carries the App definition.
      submitManifestForm(res.formActionUrl, res.manifestJson);
    },
    onError: (err) => {
      toast.error(err.message ?? "Failed to start GitHub App creation");
    },
  });

  const startConnect = useMutation({
    ...orpc.git.startConnect.mutationOptions(),
    onSuccess: (res) => {
      // Existing App for this org — hand the browser off to GitHub's
      // install page directly.
      window.location.href = res.redirectUrl;
    },
    onError: (err) => {
      // 503 NOT_CONFIGURED means "no App yet" — fall through to manifest
      // creation. Any other error is real and gets surfaced as a toast.
      if (err.message?.includes("not configured")) {
        startManifest.mutate({});
      } else {
        toast.error(err.message ?? "Failed to start GitHub install");
      }
    },
  });

  const isPending = startConnect.isPending || startManifest.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon
              icon={GitBranchIcon}
              strokeWidth={2}
              className="size-3.5"
            />
            Connect a Git provider
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] text-muted-foreground">
            Otterdeploy creates a GitHub App for your org through GitHub's
            manifest flow — no config, no env vars. You'll review and
            approve it on GitHub, then pick which repos it can see.
          </p>

          <Button
            size="lg"
            onClick={() => startConnect.mutate({ kind: "github" })}
            disabled={isPending}
          >
            <SvglLogo search={PROVIDER_SEARCH.github} fallback="GitHub" size={18} />
            {isPending ? "Redirecting…" : "Connect GitHub"}
          </Button>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Coming soon
            </span>
            <div className="grid grid-cols-3 gap-2">
              {(["gitlab", "gitea", "bitbucket"] as ProviderKind[]).map((k) => (
                <div
                  key={k}
                  className="flex flex-col items-center gap-1.5 rounded-md border bg-muted/30 p-2.5 text-[12px] font-medium text-muted-foreground"
                >
                  <SvglLogo
                    search={PROVIDER_SEARCH[k]}
                    fallback={PROVIDER_LABEL[k]}
                    size={22}
                  />
                  <span>{PROVIDER_LABEL[k]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * GitHub's manifest endpoint takes the manifest in a form field, not a
 * query param (the JSON is too big for a URL). We build a hidden form
 * and submit it from the operator's browser so GitHub sees a same-tab
 * navigation it can redirect back from.
 */
function submitManifestForm(actionUrl: string, manifestJson: string): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = actionUrl;
  // _top so iframed instances still leave their frame and land on
  // github.com fullscreen.
  form.target = "_top";

  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "manifest";
  input.value = manifestJson;
  form.appendChild(input);

  document.body.appendChild(form);
  form.submit();
}
