/**
 * Icon shim for the vendored DiceUI data-grid. The upstream component imports
 * from `lucide-react`; this repo standardizes on Hugeicons, so we re-export the
 * same lucide names as Hugeicons-wrapped components. Keeps the grid's `<Check/>`
 * call sites unchanged while dropping the lucide dependency.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Calendar03Icon,
  CheckmarkSquare02Icon,
  Copy01Icon,
  Delete02Icon,
  EraserIcon as HiEraser,
  File01Icon,
  FileAudioIcon,
  FileVideoIcon,
  Image01Icon,
  LeftToRightListBulletIcon,
  LeftToRightListNumberIcon,
  Link01Icon,
  PinIcon as HiPin,
  PinOffIcon as HiPinOff,
  PlusSignIcon,
  Scissor01Icon,
  TextIcon,
  Tick02Icon,
  Upload04Icon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";
import type { ComponentProps, ComponentType, SVGProps } from "react";

type IconData = ComponentProps<typeof HugeiconsIcon>["icon"];

// Return type matches the data-grid's icon-slot contract
// (ComponentType<SVGProps<SVGSVGElement>>). We only forward the props an icon
// actually needs (className/style); Hugeicons handles the rest.
function make(icon: IconData): ComponentType<SVGProps<SVGSVGElement>> {
  return function Icon({ className, style }: SVGProps<SVGSVGElement>) {
    return (
      <HugeiconsIcon
        icon={icon}
        strokeWidth={2}
        className={className}
        style={style}
      />
    );
  };
}

// ─── chevrons / close ───
export const ChevronDownIcon = make(ArrowDown01Icon);
export const ChevronDown = ChevronDownIcon;
export const ChevronUpIcon = make(ArrowUp01Icon);
export const ChevronUp = ChevronUpIcon;
export const XIcon = make(Cancel01Icon);
export const X = XIcon;
export const Plus = make(PlusSignIcon);
export const Check = make(Tick02Icon);
export const Upload = make(Upload04Icon);

// ─── column header / view ───
export const EyeOffIcon = make(ViewOffIcon);
export const PinIcon = make(HiPin);
// (PinOffIcon re-exported below)

// ─── context menu ───
export const CopyIcon = make(Copy01Icon);
export const EraserIcon = make(HiEraser);
export const ScissorsIcon = make(Scissor01Icon);
export const Trash2Icon = make(Delete02Icon);

// ─── column-type glyphs (lib/data-grid.ts) ───
export const BaselineIcon = make(TextIcon);
export const TextInitialIcon = make(TextIcon);
export const HashIcon = make(LeftToRightListNumberIcon);
export const CalendarIcon = make(Calendar03Icon);
export const CheckSquareIcon = make(CheckmarkSquare02Icon);
export const ListChecksIcon = make(CheckmarkSquare02Icon);
export const ListIcon = make(LeftToRightListBulletIcon);
export const LinkIcon = make(Link01Icon);
export const PinOffIcon = make(HiPinOff);

// file-type glyphs — map specific kinds where Hugeicons has them, else File01
export const FileIcon = make(File01Icon);
export const File = make(File01Icon);
export const FileArchive = make(File01Icon);
export const FileSpreadsheet = make(File01Icon);
export const FileText = make(File01Icon);
export const Presentation = make(File01Icon);
export const FileImage = make(Image01Icon);
export const FileAudio = make(FileAudioIcon);
export const FileVideo = make(FileVideoIcon);
