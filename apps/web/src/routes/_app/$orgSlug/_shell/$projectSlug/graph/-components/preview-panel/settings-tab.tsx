import { Button } from "@/shared/components/ui/button";

import { label, type Preview } from "./shared";
import { usePreviewActions } from "./use-preview-actions";

export function SettingsTab({ projectId, preview }: { projectId: string; preview: Preview }) {
  const scope = { projectId, previewId: preview.id };
  const actions = usePreviewActions(projectId);
  const { rebuild, redeploy, pause, resume, teardown, keepAlive, dbEnable, dbDisable, dbReset } =
    actions;

  const pinned = preview.autoTeardownAt === null;

  return (
    <div className="flex flex-col gap-6">
      <Section title="Build">
        <Row desc="Rebuild from the PR head commit.">
          <Button
            variant="outline"
            size="sm"
            disabled={rebuild.isPending}
            onClick={() => rebuild.mutate(scope)}
          >
            Rebuild
          </Button>
        </Row>
        <Row desc="Roll the running containers from the last built image.">
          <Button
            variant="outline"
            size="sm"
            disabled={redeploy.isPending}
            onClick={() => redeploy.mutate(scope)}
          >
            Redeploy
          </Button>
        </Row>
      </Section>

      <Section title="Lifecycle">
        <Row
          desc={
            preview.paused
              ? "Preview is paused — resume to bring it back."
              : "Stop containers, keep the preview and its URL."
          }
        >
          {preview.paused ? (
            <Button
              variant="outline"
              size="sm"
              disabled={resume.isPending}
              onClick={() => resume.mutate(scope)}
            >
              Resume
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={pause.isPending}
              onClick={() => pause.mutate(scope)}
            >
              Pause
            </Button>
          )}
        </Row>
        <Row
          desc={
            pinned
              ? "Pinned — never idle-torn-down."
              : `Idle teardown ${preview.autoTeardownAt ? new Date(preview.autoTeardownAt).toLocaleString() : ""}.`
          }
        >
          <Button
            variant="outline"
            size="sm"
            disabled={keepAlive.isPending}
            onClick={() => keepAlive.mutate({ ...scope, keepAlive: !pinned })}
          >
            {pinned ? "Enable idle teardown" : "Keep alive (pin)"}
          </Button>
        </Row>
        <Row desc="Tear down this preview now (does not close the PR).">
          <Button
            variant="outline"
            size="sm"
            className="text-destructive"
            disabled={teardown.isPending}
            onClick={() => teardown.mutate(scope)}
          >
            Tear down
          </Button>
        </Row>
      </Section>

      <Section title="Database">
        {preview.dbBranched ? (
          <Row desc="This preview runs on an isolated DB branch.">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={dbReset.isPending}
                onClick={() => dbReset.mutate(scope)}
              >
                Re-seed
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={dbDisable.isPending}
                onClick={() => dbDisable.mutate(scope)}
              >
                Use base DB
              </Button>
            </div>
          </Row>
        ) : preview.branchableDbCount > 0 ? (
          <Row desc="This preview shares the base database. Branch it for isolation.">
            <Button
              variant="outline"
              size="sm"
              disabled={dbEnable.isPending}
              onClick={() => dbEnable.mutate(scope)}
            >
              Branch database
            </Button>
          </Row>
        ) : (
          <Row desc="This preview's services don't connect to a platform database — nothing to branch." />
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className={label}>{title}</div>
      <div className="mt-2 divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
        {children}
      </div>
    </section>
  );
}

function Row({ desc, children }: { desc: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-3 py-3">
      <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">{desc}</p>
      {children}
    </div>
  );
}
