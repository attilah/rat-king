import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import { ShortId } from "./short-id.ts";
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

export interface CompactReceiptProps {
  readonly id: string;
  readonly parties: readonly {
    readonly level: string;
    readonly party: string;
  }[];
  readonly theme: Paint;
  readonly width: number;
}

export const CompactReceipt = ({
  id,
  parties,
  theme,
  width,
}: CompactReceiptProps) => {
  const [primary, ...copies] = parties;

  const first =
    primary === undefined || parties.length === 1
      ? ShortId({ id })
      : `${primary.level} · ${ShortId({ id })}`;

  const lines = [
    theme.fg("dim", first),
    ...copies.map((value) => {
      const suffix = theme.fg("dim", ` · ${value.level}`);

      return `${truncateToWidth(value.party, Math.max(0, width - 2 - visibleWidth(suffix)), "…")}${suffix}`;
    }),
  ];

  return Receipt({ lines, theme, width });
};
