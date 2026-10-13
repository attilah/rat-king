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

export const terminalStyles = (text: string) =>
  `${text.replaceAll("\u001B[1;38;", "\u001B[1m\u001B[38;")}${text.includes("\u001B[") ? "\u001B[0m" : ""}`;

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

export type Labels = (name: string) => string | undefined;

const UNKNOWN_PARTIES = new Map<string, string>();

export const noLabels: Labels = (name) => UNKNOWN_PARTIES.get(name);

export const recordType = (text: string) =>
  (/(?<type>[\w-]+(?:\.[\w-]+)+)/u.exec(clean(text))?.groups?.type ?? "unknown")
    .split(".")
    .slice(-2)
    .join(".");

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
