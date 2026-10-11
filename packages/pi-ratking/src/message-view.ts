import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Option, Schema } from "effect";

import { Kind, RelaySource, replyHint } from "./payload.ts";
import type { Inbound } from "./payload.ts";
import {
  FRAME_MIN,
  clean,
  clip,
  frame,
  oneLine,
  paragraphs,
  roleColour,
  roleOf,
  short,
} from "./tui.ts";
import type { Paint } from "./tui.ts";

const Details = Schema.Struct({
  body: Schema.String,
  cc: Schema.Boolean,
  ccNames: Schema.optional(Schema.Array(Schema.String)),
  did: Schema.String,
  from: Schema.String,
  id: Schema.String,
  kind: Kind,
  label: Schema.optional(Schema.String),
  relay: Schema.optional(RelaySource),
  replyTo: Schema.optional(Schema.String),
  sentBy: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  thread: Schema.optional(Schema.String),
  to: Schema.optional(Schema.String),
  verified: Schema.Boolean,
});

export type InboundView = typeof Details.Type;

export const COMPACT_LINES = 4;

const border = (value: InboundView) => {
  if (!value.verified) {
    return "warning";
  }

  return value.sentBy === undefined ? "borderMuted" : "dim";
};

const sender = (theme: Paint, value: InboundView, withName: boolean) => {
  const mark = value.verified
    ? theme.fg("success", "✓")
    : theme.fg("warning", "⚠");

  const colour = value.verified
    ? roleColour(roleOf(value.from, value.label))
    : "warning";

  const title =
    value.sentBy === undefined
      ? theme.fg(colour, theme.bold(oneLine(value.label ?? value.from)))
      : theme.fg("muted", `📤 to ${oneLine(value.to ?? "unknown")}`);

  const name =
    withName && value.label !== undefined && value.sentBy === undefined
      ? theme.fg("dim", ` ${oneLine(value.from)}`)
      : "";

  return `${mark} ${title}${name}`;
};

const senderLine = (
  theme: Paint,
  value: InboundView,
  withName: boolean,
  width: number
) => {
  const [mark = "", ...rest] = sender(theme, value, withName).split(" ");

  return width < 3
    ? mark
    : `${mark} ${truncateToWidth(rest.join(" "), width - 2, "…")}`;
};

const tag = (theme: Paint, value: InboundView) => {
  if (value.sentBy !== undefined) {
    return theme.fg("dim", "sent");
  }

  const parts = [
    ...(value.cc ? [theme.fg("muted", "cc")] : []),
    ...(value.kind === "ask" ? [theme.fg("warning", "ask")] : []),
    ...(value.kind === "reply" ? [theme.fg("muted", "reply")] : []),
  ];

  return parts.length === 0 ? undefined : parts.join(theme.fg("dim", " · "));
};

const ccText = (value: InboundView) =>
  (value.ccNames?.length ?? 0) > 0
    ? `cc ${(value.ccNames ?? []).map(oneLine).join(", ")}`
    : undefined;

const meta = (theme: Paint, value: InboundView, hint: string | undefined) =>
  [
    ...(value.verified ? [] : [theme.fg("warning", "unverified")]),
    ...(value.sentBy === undefined
      ? []
      : [theme.fg("muted", `sent by ${oneLine(value.sentBy)}`)]),
    ...(value.relay === undefined
      ? []
      : [theme.fg("muted", `via ${oneLine(value.relay.name)}`)]),
    ...(ccText(value) === undefined
      ? []
      : [theme.fg("muted", ccText(value) ?? "")]),
    ...(value.replyTo === undefined
      ? []
      : [theme.fg("muted", `↩ ${short(value.replyTo)}`)]),
    ...(hint === undefined ? [] : [theme.fg("dim", hint)]),
  ].join(theme.fg("dim", " · "));

const preview = (theme: Paint, value: InboundView, width: number) => [
  ...(value.summary === undefined
    ? []
    : wrapTextWithAnsi(oneLine(value.summary), width).map((line) =>
        theme.bold(line)
      )),
  ...paragraphs(value.body, width)
    .filter((line) => line !== "")
    .map((line) => theme.fg("customMessageText", line)),
];

const collapsed = (theme: Paint, value: InboundView, width: number) => {
  if (width < FRAME_MIN) {
    return [
      senderLine(theme, value, false, width),
      ...clip(theme, preview(theme, value, width), COMPACT_LINES - 1, width),
    ].map((line) => truncateToWidth(line, width, "…"));
  }

  const box = frame(theme, width, border(value));

  const lines = preview(theme, value, box.inner);
  const room = COMPACT_LINES - 2;

  return [
    box.top(sender(theme, value, false), tag(theme, value)),
    ...clip(theme, lines, room, box.inner).map(box.row),
    box.bottom(meta(theme, value, "ctrl+o expands")),
  ];
};

const expanded = (
  theme: Paint,
  tool: string,
  value: InboundView,
  width: number
) => {
  const box = frame(theme, width, border(value));

  const inner = width < FRAME_MIN ? width : box.inner;

  const dim = (text: string) =>
    wrapTextWithAnsi(text, inner).map((line) => theme.fg("dim", line));

  const details = [
    ...(value.verified
      ? []
      : wrapTextWithAnsi(
          `unverified name; sender ${oneLine(value.did)}`,
          inner
        ).map((line) => theme.fg("warning", line))),
    ...(value.relay === undefined
      ? []
      : dim(
          `via ${oneLine(value.relay.name)}${value.relay.encrypted ? " · encrypted" : ""}`
        )),
    ...(value.sentBy === undefined
      ? []
      : dim(`sent by ${oneLine(value.sentBy)}`)),
    ...(value.to === undefined || value.sentBy !== undefined
      ? []
      : dim(`to ${oneLine(value.to)}`)),
    ...(ccText(value) === undefined ? [] : dim(ccText(value) ?? "")),
    ...(value.replyTo === undefined
      ? []
      : dim(`↩ in reply to ${oneLine(value.replyTo)}`)),
    ...(value.thread === undefined
      ? []
      : dim(`thread ${oneLine(value.thread)}`)),
    ...dim(`id ${oneLine(value.id)}`),
  ];

  const summary =
    value.summary === undefined
      ? []
      : [
          ...wrapTextWithAnsi(oneLine(value.summary), inner).map((line) =>
            theme.bold(line)
          ),
          "",
        ];

  const body = paragraphs(value.body, inner).map((line) =>
    theme.fg("customMessageText", line)
  );

  const inbound: Inbound = {
    body: value.body,
    cc: value.cc,
    did: value.did,
    from: value.from,
    id: oneLine(value.id),
    kind: value.kind,
    label: Option.none(),
    replyTo: Option.none(),
    summary: Option.none(),
    verified: value.verified,
  };

  if (value.relay !== undefined) {
    Object.assign(inbound, { relay: value.relay });
  }

  const hint = replyHint(tool, inbound);

  const hints =
    value.sentBy === undefined
      ? clean(hint)
          .split("\n")
          .flatMap((line) => dim(line))
      : dim(
          `Context only: ${oneLine(value.sentBy)} already sent this. No reply needed.`
        );

  if (width < FRAME_MIN) {
    return [
      senderLine(theme, value, true, width),
      ...summary,
      ...body,
      "",
      ...details,
      ...hints,
    ].map((line) => truncateToWidth(line, width, "…"));
  }

  return [
    box.top(sender(theme, value, true), tag(theme, value)),
    ...[...summary, ...body, "", ...details].map(box.row),
    box.rule(),
    ...hints.map(box.row),
    box.bottom(),
  ];
};

export const inboundLines = (input: {
  readonly expanded: boolean;
  readonly theme: Paint;
  readonly tool: string;
  readonly value: InboundView;
  readonly width: number;
}): readonly string[] => {
  if (input.width <= 0) {
    return [];
  }

  return input.expanded
    ? expanded(input.theme, input.tool, input.value, input.width)
    : collapsed(input.theme, input.value, input.width);
};

export const messageView = (input: {
  readonly details: unknown;
  readonly expanded: boolean;
  readonly theme: Paint;
  readonly tool: string;
}): Component | undefined =>
  Schema.decodeUnknownOption(Details)(input.details).pipe(
    Option.map((value) => {
      let cache: { width: number; lines: string[] } | undefined;

      return {
        invalidate() {
          cache = undefined;
        },
        render(width: number) {
          if (cache?.width !== width) {
            cache = {
              lines: [...inboundLines({ ...input, value, width })],
              width,
            };
          }

          return cache.lines;
        },
      };
    }),
    Option.getOrUndefined
  );
