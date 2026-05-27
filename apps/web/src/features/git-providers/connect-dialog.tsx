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
  const startConnect = useMutation({
    ...orpc.git.startConnect.mutationOptions(),
    onSuccess: (res) => {
      // Hand the browser off to GitHub. The callback redirects back here
      // with ?git_install=ok|error.
      window.location.href = res.redirectUrl;
    },
    onError: (err) => {
      if (err.message?.includes("not configured")) {
        toast.error(
          "GitHub App isn't configured on this instance. Set GITHUB_APP_* env vars.",
        );
      } else {
        toast.error(err.message ?? "Failed to start GitHub install");
      }
    },
  });

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
            Pushes to a project's production branch will trigger a deploy.
            Otterstack uses a GitHub App — you'll pick which repos it can
            see on GitHub.
          </p>

          <Button
            size="lg"
            onClick={() => startConnect.mutate({ kind: "github" })}
            disabled={startConnect.isPending}
          >
            <SvglLogo search={PROVIDER_SEARCH.github} fallback="GitHub" size={18} />
            {startConnect.isPending ? "Redirecting…" : "Install on GitHub"}
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
