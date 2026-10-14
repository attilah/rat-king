import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import { terminalStyles } from "./text.ts";
import type { Paint } from "./text.ts";

export const GUTTER = 4;

export interface BlockProps {
  readonly body?: readonly string[];
  readonly footer?: string | undefined;
  readonly glyph: string;
  readonly headline: string;
  readonly theme: Paint;
  readonly width: number;
}

export const Block = ({
  body = [],
  footer,
  glyph,
  headline,
  theme,
  width,
}: BlockProps): readonly string[] => {
  if (width <= 0) {
    return [];
  }

  const room = Math.max(1, width - GUTTER);

  const content = (
    headline === "" && body.length === 0 ? [] : [headline, ...body]
  ).flatMap((line) => wrapTextWithAnsi(line, room));

  return [
    ...content.map((line, index) => {
      const mark = index === 0 ? glyph : "";

      return `${mark}${" ".repeat(Math.max(0, GUTTER - visibleWidth(mark)))}${line}`;
    }),
    ...(footer === undefined
      ? []
      : wrapTextWithAnsi(theme.fg("dim", footer), room).map((line, index) => {
          const mark = content.length === 0 && index === 0 ? glyph : "";

          return `${mark}${" ".repeat(Math.max(0, GUTTER - visibleWidth(mark)))}${line}`;
        })),
  ].map((line) => terminalStyles(truncateToWidth(line, width, "…")));
};
