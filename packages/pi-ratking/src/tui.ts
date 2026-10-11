import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export type Paint = Pick<Theme, "bold" | "fg">;

// oxlint-disable-next-line no-control-regex -- stripping control characters is the point.
const CONTROLS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/gu;

export const clean = (text: string) =>
  stripTerminalSequences(text).replaceAll("\t", "  ").replaceAll(CONTROLS, "");

export const oneLine = (text: string) =>
  clean(text).replaceAll(/\s+/gu, " ").trim();

export const paragraphs = (text: string, width: number) =>
  clean(text)
    .trim()
    .split(/\n\s*\n/u)
    .flatMap((paragraph, index) => [
      ...(index === 0 ? [] : [""]),
      ...paragraph
        .split("\n")
        .map((line) => line.trimEnd())
        .flatMap((line) =>
          line === "" ? [] : wrapTextWithAnsi(line, Math.max(1, width))
        ),
    ]);

const ROLE_COLOURS: readonly ThemeColor[] = [
  "accent",
  "mdHeading",
  "mdLink",
  "syntaxFunction",
  "syntaxKeyword",
  "syntaxString",
  "syntaxType",
  "syntaxNumber",
];

export const roleOf = (from: string, label?: string) => {
  const role = label?.split(" · ").at(-1)?.trim();

  return role === undefined || role === "" || role === label
    ? (from.split("/").at(-1) ?? from)
    : role;
};

export const roleColour = (role: string): ThemeColor => {
  let hash = 0;

  for (const char of role.toLowerCase()) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 1_000_003;
  }

  return ROLE_COLOURS[hash % ROLE_COLOURS.length] ?? "accent";
};

export const short = (id: string) => oneLine(id).slice(0, 8);

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

export const clip = (
  theme: Paint,
  lines: readonly string[],
  room: number,
  width: number
): readonly string[] => {
  if (lines.length <= room) {
    return lines;
  }

  if (room <= 0) {
    return [];
  }

  const kept = lines.slice(0, room - 1);
  const hidden = lines.length - room;
  const more = ` … +${hidden} line${hidden === 1 ? "" : "s"}`;
  const last = lines[kept.length] ?? "";

  return [
    ...kept,
    truncateToWidth(
      `${truncateToWidth(last, Math.max(0, width - visibleWidth(more)), "")}${theme.fg("dim", more)}`,
      width
    ),
  ];
};
