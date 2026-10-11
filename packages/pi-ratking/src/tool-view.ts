import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Schema } from "effect";

import { clean, clip, oneLine, paragraphs, short } from "./tui.ts";
import type { Paint } from "./tui.ts";

export interface CallArgs {
  readonly action?: string | undefined;
  readonly cc?: readonly string[] | undefined;
  readonly encrypt?: boolean | undefined;
  readonly message?: string | undefined;
  readonly replyAll?: boolean | undefined;
  readonly replyTo?: string | undefined;
  readonly successor?: string | undefined;
  readonly summary?: string | undefined;
  readonly to?: string | undefined;
}

const ACTION_COLOURS = new Map<string, ThemeColor>([
  ["ask", "warning"],
  ["reply", "success"],
  ["retire", "error"],
]);

const lines = (render: (width: number) => readonly string[]): Component => {
  let cache: { width: number; lines: string[] } | undefined;

  return {
    invalidate() {
      cache = undefined;
    },
    render(width: number) {
      if (width <= 0) {
        return [];
      }

      if (cache?.width !== width) {
        cache = {
          lines: render(width).map((line) => truncateToWidth(line, width, "…")),
          width,
        };
      }

      return cache.lines;
    },
  };
};

export const callLines = (
  tool: string,
  call: CallArgs,
  theme: Paint,
  width: number
): readonly string[] => {
  const action = oneLine(call.action ?? "");
  const dot = theme.fg("dim", " · ");

  const head = [
    `${theme.fg("toolTitle", theme.bold(tool))} ${theme.fg(ACTION_COLOURS.get(action) ?? "accent", action)}`,
    ...(call.to === undefined
      ? []
      : [`${theme.fg("muted", "→")} ${theme.fg("accent", oneLine(call.to))}`]),
    ...(call.successor === undefined
      ? []
      : [
          `${theme.fg("muted", "→")} ${theme.fg("accent", oneLine(call.successor))}`,
        ]),
  ].join(" ");

  const flags = [
    ...((call.cc?.length ?? 0) > 0
      ? [theme.fg("muted", `cc ${(call.cc ?? []).map(oneLine).join(", ")}`)]
      : []),
    ...(call.replyTo === undefined
      ? []
      : [theme.fg("muted", `↩ ${short(call.replyTo)}`)]),
    ...(call.replyAll === false ? [theme.fg("muted", "sender only")] : []),
    ...(call.encrypt === true ? [theme.fg("success", "🔒 encrypted")] : []),
  ];

  const preview = [
    ...(call.summary === undefined
      ? []
      : [theme.fg("text", oneLine(call.summary))]),
    ...(call.message === undefined
      ? []
      : [theme.fg("dim", oneLine(call.message))]),
  ];

  const [text] = preview;

  return [
    flags.length === 0 ? head : `${head}${dot}${flags.join(dot)}`,
    ...(text === undefined
      ? []
      : [`  ${truncateToWidth(text, Math.max(1, width - 2))}`]),
  ];
};

export const callView = (tool: string, call: CallArgs, theme: Paint) =>
  lines((width) => callLines(tool, call, theme, width));

export interface ResultInput {
  readonly action: string;
  readonly details: unknown;
  readonly expanded: boolean;
  readonly isError: boolean;
  readonly isPartial: boolean;
  readonly text: string;
}

const PREVIEW_LINES = 3;

const failed = (input: ResultInput) =>
  input.isError ||
  Schema.is(Schema.Struct({ error: Schema.Literal(true) }))(input.details);

const headed = (mark: string, text: string, width: number) =>
  wrapTextWithAnsi(text, Math.max(1, width - 2)).map(
    (line, index) => `${index === 0 ? mark : " "} ${line}`
  );

export const resultLines = (
  input: ResultInput,
  theme: Paint,
  width: number
): readonly string[] => {
  if (input.isPartial) {
    return [
      theme.fg(
        "warning",
        input.action === "ask" ? "⋯ waiting for the reply" : "⋯ sending"
      ),
    ];
  }

  const [first = "", ...rest] = clean(input.text).trim().split("\n");
  const head = first.replaceAll("**", "");

  if (failed(input)) {
    return [
      ...headed(theme.fg("error", "✗"), theme.fg("error", head), width),
      ...paragraphs(rest.join("\n"), width - 2).map(
        (line) => `  ${theme.fg("dim", line)}`
      ),
    ];
  }

  if (input.action === "ask") {
    const body = paragraphs(rest.join("\n"), width - 2).map(
      (line) => `  ${theme.fg("text", line)}`
    );

    return [
      ...headed(theme.fg("success", "↩"), theme.fg("accent", head), width),
      ...(input.expanded ? body : clip(theme, body, PREVIEW_LINES, width)),
    ];
  }

  if (input.action === "status") {
    const [self = "", ...facts] = head.split(" · ");

    return input.expanded
      ? [
          ...headed(theme.fg("success", "✓"), theme.fg("text", self), width),
          ...facts.flatMap((fact) =>
            wrapTextWithAnsi(fact, Math.max(1, width - 2)).map(
              (line) => `  ${theme.fg("dim", line)}`
            )
          ),
        ]
      : [
          `${theme.fg("success", "✓")} ${theme.fg("text", self)}${theme.fg("dim", facts[0] === undefined ? "" : ` · ${facts[0]}`)}`,
        ];
  }

  const others = rest
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const plain = line.replaceAll("**", "");

      const colour = /no reader|not live|offline/iu.test(plain)
        ? "warning"
        : "dim";

      return wrapTextWithAnsi(plain, Math.max(1, width - 2)).map(
        (wrapped) => `  ${theme.fg(colour, wrapped)}`
      );
    });

  const tail = others.flat();

  return [
    ...headed(theme.fg("success", "✓"), theme.fg("text", head), width),
    ...(input.expanded ? tail : clip(theme, tail, PREVIEW_LINES, width)),
  ];
};

export const resultView = (input: ResultInput, theme: Paint) =>
  lines((width) => resultLines(input, theme, width));
