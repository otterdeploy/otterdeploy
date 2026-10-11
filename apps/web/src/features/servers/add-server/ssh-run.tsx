/**
 * An SSH install after Connect and install: the four steps while it runs, then
 * one outcome. A failure names the step it stopped on, quotes the runner's own
 * error, and shows the install output in the app's log style.
 */

import type { ServerId } from "@otterdeploy/shared/id";

import { Link, useParams } from "@tanstack/react-router";

import { LogLineRow } from "@/features/logs/components/log-line-row";
import { Button } from "@/shared/components/ui/button";

import {
  failedSshStep,
  sshSteps,
  type ProvisionLine,
} from "../components/server-provision-stepper";
import { serverDisplayName } from "../detail/server-facts";
import { InstallSteps, Outcome } from "./install-steps";
import { PanelBody, PanelFooter } from "./panel";
import { useProvisionRun } from "./use-provision-run";

/** The failure headline, by the step the run stopped on. */
export function sshFailureTitle(step: string | null, host: string): string {
  if (step === "ssh") return `Couldn't connect to ${host} over SSH`;
  if (step === "check") return `${host} didn't pass the system check`;
  if (step === "docker") return `Docker didn't install on ${host}`;
  if (step === "connected") return `${host} installed but didn't connect`;
  return `The install stopped on ${host}`;
}

function InstallOutput({ lines }: { lines: readonly ProvisionLine[] }) {
  return (
    <div
      aria-label="Install output"
      className="max-h-56 overflow-auto rounded-md border bg-terminal p-3 font-mono text-[11.5px] leading-relaxed text-terminal-foreground"
    >
      {lines.length === 0 ? (
        <span className="text-muted-foreground">No output was captured.</span>
      ) : (
        lines.map((l, i) => (
          <LogLineRow
            key={`${l.ts}:${i}`}
            line={{ id: i, stream: "system", line: l.line, ts: null }}
            showTimestamp={false}
          />
        ))
      )}
    </div>
  );
}

export function SshRun({ serverId, onClose }: { serverId: ServerId; onClose: () => void }) {
  const { orgSlug } = useParams({ strict: false });
  const { lines, row, outcome } = useProvisionRun(serverId);
  const steps = sshSteps(lines, row);
  const host = row ? row.host : "the server";

  if (outcome === "ready") {
    return (
      <>
        <PanelBody>
          <Outcome tone="ok" title={`${row ? serverDisplayName(row) : "The server"} is connected`}>
            It can run workloads now.
          </Outcome>
        </PanelBody>
        <PanelFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          {orgSlug ? (
            <Button
              nativeButton={false}
              render={<Link to="/$orgSlug/servers/$serverId" params={{ orgSlug, serverId }} />}
            >
              Open server
            </Button>
          ) : null}
        </PanelFooter>
      </>
    );
  }

  if (outcome === "failed") {
    return (
      <>
        <PanelBody>
          <Outcome tone="err" title={sshFailureTitle(failedSshStep(steps), host)}>
            {row?.provisionError ??
              "The installer stopped. Fix the cause, then retry from its card on the Servers page."}
          </Outcome>
          <InstallOutput lines={lines} />
        </PanelBody>
        <PanelFooter>
          <Button type="button" onClick={onClose}>
            Close
          </Button>
        </PanelFooter>
      </>
    );
  }

  return (
    <>
      <PanelBody>
        <InstallSteps steps={steps} />
      </PanelBody>
      <PanelFooter
        lead={<span className="text-sm text-muted-foreground">Safe to close. It keeps going.</span>}
      >
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
      </PanelFooter>
    </>
  );
}
