/**
 * The Command tab's body and footer, one per phase: confirm, ready (the
 * command and a countdown), installing (the four steps), and one outcome each
 * for connected, expired and revoked.
 */

import { Clock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { epochMsFromIso } from "@/shared/lib/clock";
import { formatDuration } from "@/shared/lib/duration";

import type { CommandFlow } from "./command-flow";

import { enrollmentSteps, enrollmentTook } from "../components/enrollment-progress";
import { CommandBlock } from "./command-block";
import { EarlierCommands } from "./earlier-commands";
import { clockSpan } from "./install-step";
import { InstallSteps, Outcome } from "./install-steps";
import { PanelFooter } from "./panel";

const CREDENTIAL_ID = "add-server-credential";
/** A command lives 10 minutes (`ttlMinutes: 10` in ./command-flow). */
const COMMAND_TTL_MS = 10 * 60 * 1000;
const CREDENTIAL_NOTE_ID = "add-server-credential-note";

function ConfirmStep({ flow }: { flow: CommandFlow }) {
  const label = flow.twoFactor ? "Authenticator code" : "Password";
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        flow.submit();
      }}
    >
      <Field data-invalid={flow.fieldError ? true : undefined}>
        <FieldLabel htmlFor={CREDENTIAL_ID}>{label}</FieldLabel>
        <div className="flex gap-2">
          <Input
            id={CREDENTIAL_ID}
            className={flow.twoFactor ? "flex-1 font-mono" : "flex-1"}
            type={flow.twoFactor ? "text" : "password"}
            inputMode={flow.twoFactor ? "numeric" : undefined}
            autoComplete={flow.twoFactor ? "one-time-code" : "current-password"}
            maxLength={flow.twoFactor ? 8 : undefined}
            placeholder={flow.twoFactor ? "000000" : "Your account password"}
            value={flow.credential}
            disabled={flow.sessionPending}
            aria-invalid={flow.fieldError ? true : undefined}
            aria-describedby={CREDENTIAL_NOTE_ID}
            onChange={(event) => flow.setCredential(event.target.value)}
          />
          <Button type="submit" disabled={flow.creating || flow.sessionPending}>
            {flow.creating ? "Creating…" : "Create command"}
          </Button>
        </div>
        {flow.fieldError ? (
          <FieldError id={CREDENTIAL_NOTE_ID}>{flow.fieldError}</FieldError>
        ) : (
          <FieldDescription id={CREDENTIAL_NOTE_ID}>
            Confirms it&apos;s you. The command works once and expires after 10 minutes.
          </FieldDescription>
        )}
      </Field>
    </form>
  );
}

/** "Waiting for the server to run it · expires in m:ss". The dot is the one
 *  live element: the control plane is listening right now. */
function WaitingLine({ expiresAt, now }: { expiresAt: string; now: number }) {
  const end = epochMsFromIso(expiresAt);
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <span aria-hidden className="relative flex size-2">
        <span className="absolute inline-flex size-full rounded-full bg-primary/40 motion-safe:animate-ping" />
        <span className="relative inline-flex size-2 rounded-full bg-primary" />
      </span>
      <span role="status">Waiting for the server to run it</span>
      <span aria-hidden>·</span>
      <span>
        expires in{" "}
        <strong className="font-medium text-foreground tabular-nums">
          {/* Capped at the command's lifetime: a browser clock running a
              little behind the server's must not show more than 10:00. */}
          {end === null ? "—" : clockSpan(Math.min(end - now, COMMAND_TTL_MS))}
        </strong>
      </span>
    </p>
  );
}

function PhaseBody({ flow }: { flow: CommandFlow }) {
  const { phase, row, created, command } = flow;
  if (phase === "confirm") return <ConfirmStep flow={flow} />;
  if (phase === "ready" && created && command) {
    return (
      <div className="flex flex-col gap-4">
        <CommandBlock command={command} token={created.credential} />
        <WaitingLine expiresAt={row?.expiresAt ?? created.expiresAt} now={flow.now} />
      </div>
    );
  }
  if (phase === "installing" && row) return <InstallSteps steps={enrollmentSteps(row)} />;
  if (phase === "connected" && row) {
    const took = enrollmentTook(row);
    return (
      <Outcome tone="ok" title="The server is connected">
        {took === null
          ? "It can run workloads now."
          : `It joined in ${formatDuration(took)} and can run workloads now.`}
      </Outcome>
    );
  }
  if (phase === "revoked") {
    return (
      <Outcome tone="muted" title="This command was revoked">
        It can no longer be used. Create a new one when the server is ready.
      </Outcome>
    );
  }
  return (
    <Outcome tone="muted" title="This command expired">
      Nothing ran it in 10 minutes. Create a new one when the server is ready.
    </Outcome>
  );
}

export function CommandBody({ flow }: { flow: CommandFlow }) {
  return (
    <div className="flex flex-col gap-5">
      <PhaseBody flow={flow} />
      {flow.historyOpen &&
      flow.earlier.length > 0 &&
      (flow.phase === "confirm" || flow.phase === "ready") ? (
        <EarlierCommands rows={flow.earlier} revoking={flow.revoking} onRevoke={flow.revoke} />
      ) : null}
    </div>
  );
}

/** The footer's left side: earlier commands while you might want them, a
 *  reassurance while an install runs, nothing once it has an answer. */
function FooterLead({ flow }: { flow: CommandFlow }) {
  if (flow.phase === "installing") {
    return <span className="text-sm text-muted-foreground">Safe to close. It keeps going.</span>;
  }
  if ((flow.phase === "confirm" || flow.phase === "ready") && flow.earlier.length > 0) {
    const n = flow.earlier.length;
    return (
      <Button
        type="button"
        variant="link"
        className="h-auto gap-1.5 px-0 font-normal text-muted-foreground hover:text-foreground"
        aria-expanded={flow.historyOpen}
        onClick={flow.toggleHistory}
      >
        <HugeiconsIcon icon={Clock01Icon} strokeWidth={2} className="size-3.5" />
        {flow.historyOpen ? "Hide earlier commands" : `${n} earlier command${n === 1 ? "" : "s"}`}
      </Button>
    );
  }
  return null;
}

function FooterActions({ flow, onClose }: { flow: CommandFlow; onClose: () => void }) {
  if (flow.phase === "confirm") {
    return (
      <Button type="button" variant="outline" onClick={onClose}>
        Cancel
      </Button>
    );
  }
  if (flow.phase === "connected") {
    return (
      <>
        <Button type="button" variant="outline" onClick={flow.startOver}>
          Add another
        </Button>
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      </>
    );
  }
  if (flow.phase === "expired" || flow.phase === "revoked") {
    return (
      <>
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button type="button" onClick={flow.startOver}>
          New command
        </Button>
      </>
    );
  }
  return (
    <Button type="button" variant="outline" onClick={onClose}>
      Close
    </Button>
  );
}

export function CommandFooter({ flow, onClose }: { flow: CommandFlow; onClose: () => void }) {
  return (
    <PanelFooter lead={<FooterLead flow={flow} />}>
      <FooterActions flow={flow} onClose={onClose} />
    </PanelFooter>
  );
}
