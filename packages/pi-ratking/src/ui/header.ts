import type { ThemeColor } from "@earendil-works/pi-coding-agent";

import { Brand } from "./brand.ts";
import { oneLine } from "./text.ts";
import type { Paint } from "./text.ts";

export type HeaderVariant = "call" | "inbound" | "digest" | "record";

export interface HeaderProps {
  readonly colour?: ThemeColor;
  readonly facts?: readonly string[];
  readonly party?: string;
  readonly theme: Paint;
  readonly variant: HeaderVariant;
  readonly verb: string;
}

export const Header = ({
  colour = "accent",
  facts = [],
  party,
  theme,
  verb,
}: HeaderProps) =>
  `${Brand({ theme })} ${theme.fg(colour, oneLine(verb))}${party === undefined ? "" : ` ${party}`}${facts.map((fact) => theme.fg("dim", ` · ${fact}`)).join("")}`;
