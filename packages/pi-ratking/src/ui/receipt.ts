import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { Paint } from "./text.ts";

export interface ReceiptProps {
  readonly lines: readonly string[];
  readonly theme: Paint;
  readonly width: number;
}

export const headed = (mark: string, text: string, width: number) =>
  wrapTextWithAnsi(text, Math.max(1, width - 2)).map(
    (line, index) => `${index === 0 ? mark : " "} ${line}`
  );

export const Receipt = ({ lines, theme, width }: ReceiptProps) =>
  lines.flatMap((line) => headed(theme.fg("success", "✓"), line, width));
