import { oneLine, roleColour, roleOf } from "./text.ts";
import type { Paint } from "./text.ts";

export type PartyVariant = "collapsed" | "expanded";

export interface PartyProps {
  readonly label?: string | undefined;
  readonly name: string;
  readonly theme: Paint;
  readonly variant?: PartyVariant;
}

export const Party = ({
  label,
  name,
  theme,
  variant = "collapsed",
}: PartyProps) => {
  const title = oneLine(label ?? name);
  const colour = roleColour(roleOf(name, label));

  return `${theme.fg(colour, theme.bold(title))}${label === undefined || variant === "collapsed" ? "" : theme.fg("dim", ` (${oneLine(name)})`)}`;
};
