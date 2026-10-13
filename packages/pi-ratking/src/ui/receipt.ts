import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import { ShortId } from "./short-id.ts";
import { oneLine } from "./text.ts";
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
  readonly summary?: string | undefined;
  readonly theme: Paint;
  readonly trimmed: boolean;
  readonly width: number;
}

const contentLine = (
  party: string,
  summary: string,
  id: string,
  width: number,
  theme: Paint
) => {
  const suffix = theme.fg(
    "dim",
    `${party === "" && summary === "" ? "" : " · "}${ShortId({ id })}`
  );

  const lead = truncateToWidth(
    party,
    Math.max(0, width - visibleWidth(suffix)),
    "…"
  );

  const room =
    width - visibleWidth(lead) - visibleWidth(suffix) - (lead === "" ? 0 : 3);

  const content =
    room > 0 && summary !== ""
      ? theme.fg(
          "dim",
          `${lead === "" ? "" : " · "}${truncateToWidth(summary, room, "…")}`
        )
      : "";

  return `${lead}${content}${suffix}`;
};

export const CompactReceipt = ({
  id,
  parties,
  summary,
  theme,
  trimmed,
  width,
}: CompactReceiptProps) => {
  const text = [oneLine(summary ?? ""), ...(trimmed ? ["summary trimmed"] : [])]
    .filter((value) => value !== "")
    .join(" · ");

  const first = parties[0]?.party ?? "";

  const lines =
    parties.length === 1
      ? [contentLine(first, text, id, width - 2, theme)]
      : [
          contentLine("", text, id, width - 2, theme),
          ...parties.map((value) => {
            const suffix = theme.fg("dim", ` · ${value.level}`);

            return `${truncateToWidth(value.party, Math.max(0, width - 2 - visibleWidth(suffix)), "…")}${suffix}`;
          }),
        ];

  return Receipt({ lines, theme, width });
};
