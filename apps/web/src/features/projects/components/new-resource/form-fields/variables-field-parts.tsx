/**
 * The per-row editing pieces of the VariablesField: the row itself, its value
 * cell and the small controls inside it. Split out of variables-field.tsx to
 * keep that file + its main component under the line caps.
 *
 * The dotenv parse/serialize helpers and the bulk surfaces that use them live
 * in ./variables-field-dotenv and are re-exported here, so the field keeps
 * importing everything from one module.
 */

import { Fragment, useState } from "react";

import { AlertDiamondIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { ReferencePicker } from "@/features/projects/components/variables";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { TableCell, TableRow } from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";

import type { Var } from "./variables-field";

import { I } from "../icons";

export { BulkEditor, EmptyDropzone, parseEnvText, serializeEnv } from "./variables-field-dotenv";

/** One of the small square controls that sit inside the value input (reveal,
 *  reference picker). Split out of the value cell so both buttons share one
 *  active/idle styling rule instead of repeating the ternary. */
function TrailingToggle({
  active,
  label,
  title,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      onClick={onClick}
      className={cn(
        "grid size-6 place-items-center rounded transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground/70 hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** Right padding the value input needs so typed text doesn't run under the
 *  trailing buttons. Its own helper so the cell reads as markup, not math. */
function valuePaddingClass(trailingButtons: number): string {
  if (trailingButtons >= 2) return "pr-14";
  if (trailingButtons === 1) return "pr-8";
  return "";
}

/** The value cell of a variable row: the input plus its trailing controls.
 *  Split out of VariableRow because masking is a concern of its own. The
 *  reveal state is per-row and local, and it decides both the input type and
 *  how much room the buttons need. */
function VariableValueCell({
  v,
  projectId,
  pickerOpen,
  onValueInput,
  onTogglePicker,
}: {
  v: Var;
  projectId?: string;
  pickerOpen: boolean;
  onValueInput: (value: string) => void;
  onTogglePicker: () => void;
}) {
  // Reveal a masked secret so the operator can read the auto-generated value
  // (and copy it). Per-row, defaults to hidden.
  const [reveal, setReveal] = useState(false);
  const masked = v.secret && !reveal;
  const revealLabel = reveal ? "Hide value" : "Reveal value";
  // How many trailing buttons sit in the value cell → how much right padding
  // the input needs so the text doesn't run under them.
  const trailingButtons = (v.secret ? 1 : 0) + (projectId ? 1 : 0);

  return (
    <div className="relative">
      <Input
        type={masked ? "password" : "text"}
        value={v.value}
        placeholder={v.secret ? "••••••••" : "value"}
        onChange={(e) => onValueInput(e.target.value)}
        className={cn("h-8 font-mono", valuePaddingClass(trailingButtons))}
      />
      <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
        {v.secret && (
          <TrailingToggle
            active={reveal}
            label={revealLabel}
            title={revealLabel}
            onClick={() => setReveal((r) => !r)}
          >
            <I.eye width={12} height={12} />
          </TrailingToggle>
        )}
        {projectId && (
          <TrailingToggle
            active={pickerOpen}
            label="Insert reference"
            title="Insert a ${{ resource.KEY }} reference"
            onClick={onTogglePicker}
          >
            <span className="font-mono text-[10.5px] leading-none">{"{ }"}</span>
          </TrailingToggle>
        )}
      </div>
    </div>
  );
}

interface VariableRowProps {
  v: Var;
  projectId?: string;
  pickerOpen: boolean;
  onKeyChange: (key: string) => void;
  onValueInput: (value: string) => void;
  onTogglePicker: () => void;
  onToggleSecret: () => void;
  onRemove: () => void;
  onPick: (token: string) => void;
  onClosePicker: () => void;
}

export function VariableRow({
  v,
  projectId,
  pickerOpen,
  onKeyChange,
  onValueInput,
  onTogglePicker,
  onToggleSecret,
  onRemove,
  onPick,
  onClosePicker,
}: VariableRowProps) {
  return (
    <Fragment>
      <TableRow>
        <TableCell className="py-2">
          <Input
            type="text"
            value={v.key}
            placeholder="KEY"
            onChange={(e) => onKeyChange(e.target.value)}
            className="h-8 font-mono"
          />
        </TableCell>
        <TableCell className="py-2">
          <VariableValueCell
            v={v}
            projectId={projectId}
            pickerOpen={pickerOpen}
            onValueInput={onValueInput}
            onTogglePicker={onTogglePicker}
          />
        </TableCell>
        <TableCell className="py-2 text-center">
          {v.required && v.value.trim() === "" && (
            <span
              title="Required. Fill this in before the stack can deploy."
              aria-label="Required, empty"
              className="inline-flex text-destructive"
            >
              <HugeiconsIcon icon={AlertDiamondIcon} strokeWidth={2} className="size-4" />
            </span>
          )}
        </TableCell>
        <TableCell className="py-2 text-center">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title={v.secret ? "Mark as plain" : "Mark as secret"}
            onClick={onToggleSecret}
            className={v.secret ? "text-foreground" : "text-muted-foreground"}
          >
            <I.lock width={12} height={12} />
          </Button>
        </TableCell>
        <TableCell className="py-2 text-right">
          <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove}>
            <I.x width={11} height={11} />
          </Button>
        </TableCell>
      </TableRow>
      {projectId && pickerOpen && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={5} className="py-0 pb-2">
            <ReferencePicker projectId={projectId} onPick={onPick} onClose={onClosePicker} />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}
