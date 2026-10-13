import { Fold } from "./fold.ts";
import { headed } from "./receipt.ts";
import { paragraphs } from "./text.ts";
import type { Paint } from "./text.ts";

export interface FaultProps {
  readonly diagnostics: string;
  readonly expanded: boolean;
  readonly reason: string;
  readonly theme: Paint;
  readonly width: number;
}

export const Fault = ({
  diagnostics,
  expanded,
  reason,
  theme,
  width,
}: FaultProps) => [
  ...headed(theme.fg("error", "✗"), theme.fg("error", reason), width),
  ...Fold({
    collapsed: () => [],
    expanded,
    full: () =>
      paragraphs(diagnostics, width - 2).map(
        (line) => `  ${theme.fg("dim", line)}`
      ),
  }),
];
