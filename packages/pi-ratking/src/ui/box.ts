import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { Paint } from "./text.ts";

export const FRAME_MIN = 16;

export interface Frame {
  readonly inner: number;
  readonly top: (left: string, right?: string) => string;
  readonly row: (content: string) => string;
  readonly rule: () => string;
  readonly bottom: (meta?: string) => string;
}

export const frame = (
  theme: Paint,
  width: number,
  border: ThemeColor
): Frame => {
  const line = (text: string) => theme.fg(border, text);
  const inner = width - 4;

  const edge = (open: string, close: string, left?: string, right?: string) => {
    const span = width - 2;
    const tail = right === undefined ? "" : ` ${right} `;

    const tailFits =
      right !== undefined &&
      left !== undefined &&
      span - 3 - visibleWidth(tail) - 2 >= Math.min(8, visibleWidth(left));

    const rightPart = tailFits ? tail : "";

    if (left === undefined || span < 5) {
      return line(`${open}${"─".repeat(Math.max(0, span))}${close}`);
    }

    const room = span - 3 - visibleWidth(rightPart) - 2;
    const title = truncateToWidth(left, Math.max(1, room), "…");

    const fill = Math.max(
      0,
      span - 3 - visibleWidth(title) - visibleWidth(rightPart) - 1
    );

    return `${line(`${open}─ `)}${title}${line(` ${"─".repeat(fill)}`)}${rightPart}${line(`─${close}`)}`;
  };

  return {
    bottom: (meta) => edge("╰", "╯", meta),
    inner,
    row: (content) => {
      const text = truncateToWidth(content, inner, "…");
      const pad = " ".repeat(Math.max(0, inner - visibleWidth(text)));

      return `${line("│")} ${text}${pad} ${line("│")}`;
    },
    rule: () => line(`├${"─".repeat(width - 2)}┤`),
    top: (left, right) => edge("╭", "╮", left, right),
  };
};

export interface BoxProps {
  readonly body: readonly string[];
  readonly border: ThemeColor;
  readonly footer?: string | undefined;
  readonly header: string;
  readonly tail?: readonly string[];
  readonly tag?: string | undefined;
  readonly theme: Paint;
  readonly width: number;
}

export const Box = ({
  body,
  border,
  footer,
  header,
  tail,
  tag,
  theme,
  width,
}: BoxProps): readonly string[] => {
  if (width <= 0) {
    return [];
  }

  if (width < FRAME_MIN) {
    return [
      header,
      ...body,
      ...(tail ?? []),
      ...(footer === undefined ? [] : [footer]),
    ].map((line) => truncateToWidth(line, width, "…"));
  }

  const box = frame(theme, width, border);

  return [
    box.top(header, tag),
    ...body.map(box.row),
    ...(tail === undefined ? [] : [box.rule(), ...tail.map(box.row)]),
    box.bottom(footer),
  ];
};
