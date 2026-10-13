import type { ThemeColor } from "@earendil-works/pi-coding-agent";

import { Header } from "./ui/header.ts";
import { Party } from "./ui/party.ts";
import { ShortId } from "./ui/short-id.ts";
import type { Paint } from "./ui/text.ts";

export { FRAME_MIN, frame } from "./ui/box.ts";

export type { Frame } from "./ui/box.ts";

export {
  clean,
  clip,
  noLabels,
  oneLine,
  paragraphs,
  recordType,
  roleColour,
  roleOf,
  terminalStyles,
} from "./ui/text.ts";

export type { Labels, Paint } from "./ui/text.ts";

export const party = (theme: Paint, name: string, label?: string) =>
  Party({ label, name, theme });

export const ratKingTitle = (
  theme: Paint,
  action: string,
  colour: ThemeColor = "accent"
) => Header({ colour, theme, variant: "call", verb: action });

export const short = (id: string) => ShortId({ id });
